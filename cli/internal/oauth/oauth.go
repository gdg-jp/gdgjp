package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

// issuer is a var, not a const, so tests can point it at an httptest server.
var issuer = "https://accounts.gdgs.jp"

const (
	clientID                  = "gdg-cli"
	redirectURI               = "http://127.0.0.1:8787/callback"
	callbackPath              = "/callback"
	cliScope                  = "https://gdgs.jp/scopes/cli"
	chaptersScope             = "https://gdgs.jp/scopes/chapters"
	deviceGrantType           = "urn:ietf:params:oauth:grant-type:device_code"
	defaultDevicePollInterval = 5 * time.Second
	defaultDeviceExpiry       = 10 * time.Minute
)

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
}

func Login(ctx context.Context) (store.Credentials, error) {
	state, err := randomValue(32)
	if err != nil {
		return store.Credentials{}, err
	}
	verifier, err := randomValue(64)
	if err != nil {
		return store.Credentials{}, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:8787")
	if err != nil {
		return store.Credentials{}, fmt.Errorf("start login callback: %w", err)
	}
	defer listener.Close()

	result := make(chan string, 1)
	server := &http.Server{Handler: callbackHandler(state, result)}
	go func() { _ = server.Serve(listener) }()
	defer server.Shutdown(context.Background())

	authorizeURL := authorizationURL(state, verifier)
	fmt.Printf("Open this URL in your browser to continue:\n%s\n", authorizeURL)
	if err := openBrowser(authorizeURL); err != nil {
		// The printed URL keeps login usable on headless systems.
		fmt.Printf("Could not open a browser automatically: %v\n", err)
	}

	select {
	case code := <-result:
		return exchange(ctx, code, verifier)
	case <-time.After(2 * time.Minute):
		return store.Credentials{}, errors.New("login timed out waiting for the browser callback")
	case <-ctx.Done():
		return store.Credentials{}, ctx.Err()
	}
}

func Logout(ctx context.Context, credentials store.Credentials) error {
	accessToken := credentials.AccessToken
	if accessToken == "" {
		refreshed, err := Refresh(ctx, credentials.RefreshToken)
		if err != nil {
			return fmt.Errorf("refresh access token for logout: %w", err)
		}
		accessToken = refreshed.AccessToken
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, issuer+"/api/cli/logout", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("contact GDG Japan Accounts: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("logout failed: %s: %s", response.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

const loginScope = "openid profile email offline_access " + chaptersScope + " " + cliScope

func authorizationURL(state, verifier string) string {
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"scope":                 {loginScope},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	return issuer + "/api/auth/oauth2/authorize?" + query.Encode()
}

// LikelyHeadless reports whether the current session probably has no
// browser available, so gdg login can default to the device-code flow
// without requiring the caller to pass --device explicitly. SSH sessions
// with X11/Wayland forwarding still have a real display, so they are not
// treated as headless.
func LikelyHeadless() bool {
	return likelyHeadless(runtime.GOOS, os.Getenv)
}

func likelyHeadless(goos string, getenv func(string) string) bool {
	sshSession := getenv("SSH_CONNECTION") != "" || getenv("SSH_TTY") != ""
	if !sshSession {
		return false
	}
	if goos == "linux" {
		return getenv("DISPLAY") == "" && getenv("WAYLAND_DISPLAY") == ""
	}
	return true
}

type deviceAuthorizationResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type deviceErrorResponse struct {
	Error string `json:"error"`
}

// DeviceLogin runs the OAuth 2.0 Device Authorization Grant (RFC 8628): it
// prints a short code and verification URL for the user to open on any
// device with a browser, then polls until it is approved. This keeps login
// usable on hosts with no local browser at all, such as SSH remote servers.
func DeviceLogin(ctx context.Context) (store.Credentials, error) {
	authResponse, err := requestDeviceAuthorization(ctx)
	if err != nil {
		return store.Credentials{}, err
	}

	fmt.Printf("To sign in, open this URL and enter the code below:\n%s\n\nCode: %s\n", authResponse.VerificationURI, authResponse.UserCode)
	if authResponse.VerificationURIComplete != "" {
		fmt.Printf("Or open this URL directly:\n%s\n", authResponse.VerificationURIComplete)
	}

	interval := time.Duration(authResponse.Interval) * time.Second
	if interval <= 0 {
		interval = defaultDevicePollInterval
	}
	expiresIn := time.Duration(authResponse.ExpiresIn) * time.Second
	if expiresIn <= 0 {
		expiresIn = defaultDeviceExpiry
	}
	deadline := time.Now().Add(expiresIn)

	for {
		select {
		case <-ctx.Done():
			return store.Credentials{}, ctx.Err()
		case <-time.After(interval):
		}
		if time.Now().After(deadline) {
			return store.Credentials{}, errors.New("device login expired before it was approved")
		}

		credentials, pollErr, err := pollDeviceToken(ctx, authResponse.DeviceCode)
		if err != nil {
			return store.Credentials{}, err
		}
		switch pollErr {
		case "":
			return credentials, nil
		case "authorization_pending":
			continue
		case "slow_down":
			interval += 5 * time.Second
			continue
		case "access_denied":
			return store.Credentials{}, errors.New("device login was denied")
		case "expired_token":
			return store.Credentials{}, errors.New("device login expired before it was approved")
		default:
			return store.Credentials{}, fmt.Errorf("device login failed: %s", pollErr)
		}
	}
}

func requestDeviceAuthorization(ctx context.Context) (deviceAuthorizationResponse, error) {
	form := url.Values{
		"client_id": {clientID},
		"scope":     {loginScope},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, issuer+"/api/auth/oauth2/device_authorization", strings.NewReader(form.Encode()))
	if err != nil {
		return deviceAuthorizationResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return deviceAuthorizationResponse{}, fmt.Errorf("start device login: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return deviceAuthorizationResponse{}, fmt.Errorf("device authorization request failed: %s: %s", response.Status, strings.TrimSpace(string(body)))
	}
	var authResponse deviceAuthorizationResponse
	if err := json.NewDecoder(response.Body).Decode(&authResponse); err != nil {
		return deviceAuthorizationResponse{}, err
	}
	if authResponse.DeviceCode == "" || authResponse.UserCode == "" {
		return deviceAuthorizationResponse{}, errors.New("device authorization response missing device_code or user_code")
	}
	return authResponse, nil
}

// pollDeviceToken makes one poll attempt. A non-empty pollErr is an RFC 8628
// token-endpoint error code (authorization_pending, slow_down, ...) for the
// caller to interpret; err is reserved for transport/decoding failures.
func pollDeviceToken(ctx context.Context, deviceCode string) (store.Credentials, string, error) {
	form := url.Values{
		"grant_type":  {deviceGrantType},
		"device_code": {deviceCode},
		"client_id":   {clientID},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, issuer+"/api/auth/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return store.Credentials{}, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return store.Credentials{}, "", err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return store.Credentials{}, "", err
	}
	if response.StatusCode != http.StatusOK {
		var errResponse deviceErrorResponse
		if json.Unmarshal(body, &errResponse) != nil || errResponse.Error == "" {
			return store.Credentials{}, "", fmt.Errorf("device token request failed: %s: %s", response.Status, strings.TrimSpace(string(body)))
		}
		return store.Credentials{}, errResponse.Error, nil
	}
	var token tokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return store.Credentials{}, "", err
	}
	if token.AccessToken == "" || token.RefreshToken == "" {
		return store.Credentials{}, "", errors.New("token response did not contain access and refresh tokens")
	}
	return store.Credentials{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, TokenType: token.TokenType}, "", nil
}

func callbackHandler(expectedState string, result chan<- string) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != callbackPath {
			http.NotFound(writer, request)
			return
		}
		if request.URL.Query().Get("state") != expectedState {
			http.Error(writer, "Invalid login state.", http.StatusBadRequest)
			return
		}
		code := request.URL.Query().Get("code")
		if code == "" {
			http.Error(writer, "Authorization failed. Return to the terminal and try again.", http.StatusBadRequest)
			return
		}
		select {
		case result <- code:
			writer.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(writer, loginCompletePage)
		default:
			http.Error(writer, "Login callback was already received.", http.StatusConflict)
		}
	})
}

const loginCompletePage = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ログインが完了しました · GDG Japan</title>
    <style>
      :root { color-scheme: light dark; }
      * { box-sizing: border-box; }
      body {
        align-items: center;
        background: #f8f9fa;
        color: #202124;
        display: flex;
        font-family: "Google Sans", "Noto Sans JP", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        overflow: hidden;
        padding: 24px;
      }
      body::before, body::after {
        border-radius: 999px;
        content: "";
        filter: blur(56px);
        opacity: .2;
        pointer-events: none;
        position: fixed;
      }
      body::before { background: #4285f4; height: 280px; right: -100px; top: -100px; width: 280px; }
      body::after { background: #fbbc04; bottom: -110px; height: 260px; left: -100px; width: 260px; }
      main { position: relative; width: min(100%, 400px); }
      .card {
        background: rgba(255, 255, 255, .94);
        border: 1px solid #e3e6e9;
        border-radius: 16px;
        box-shadow: 0 10px 28px rgba(60, 64, 67, .12);
        padding: 40px 32px;
        text-align: center;
      }
      .mark {
        align-items: center;
        background: #e8f0fe;
        border-radius: 999px;
        color: #1a73e8;
        display: inline-flex;
        height: 48px;
        justify-content: center;
        margin-bottom: 20px;
        width: 48px;
      }
      h1 { font-size: 24px; letter-spacing: -.02em; margin: 0; }
      p { color: #5f6368; font-size: 15px; line-height: 1.6; margin: 12px 0 0; }
      .badge { color: #5f6368; font-size: 12px; margin-top: 28px; }
      @media (prefers-color-scheme: dark) {
        body { background: #202124; color: #e8eaed; }
        .card { background: rgba(32, 33, 36, .94); border-color: #3c4043; }
        p, .badge { color: #bdc1c6; }
        .mark { background: #1a3b6d; color: #8ab4f8; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card" aria-labelledby="title">
        <div class="mark" aria-hidden="true">
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.2 4.2L19 6.5"/></svg>
        </div>
        <h1 id="title">ログインが完了しました</h1>
        <p>GDG Japan CLI にログインしました。<br>このウィンドウは閉じて構いません。</p>
        <div class="badge">GDG Japan</div>
      </section>
    </main>
  </body>
</html>`

func exchange(ctx context.Context, code, verifier string) (store.Credentials, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {clientID},
		"code":          {code},
		"redirect_uri":  {redirectURI},
		"code_verifier": {verifier},
	}
	return requestToken(ctx, form)
}

// Refresh exchanges a saved refresh token for a fresh CLI credential set.
func Refresh(ctx context.Context, refreshToken string) (store.Credentials, error) {
	return requestToken(ctx, url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {clientID},
		"refresh_token": {refreshToken},
	})
}

func requestToken(ctx context.Context, form url.Values) (store.Credentials, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, issuer+"/api/auth/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return store.Credentials{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return store.Credentials{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return store.Credentials{}, fmt.Errorf("token request failed: %s: %s", response.Status, strings.TrimSpace(string(body)))
	}
	var token tokenResponse
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil {
		return store.Credentials{}, err
	}
	if token.AccessToken == "" || token.RefreshToken == "" {
		return store.Credentials{}, errors.New("token response did not contain access and refresh tokens")
	}
	return store.Credentials{AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, TokenType: token.TokenType}, nil
}

func randomValue(size int) (string, error) {
	bytes := make([]byte, size)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func openBrowser(rawURL string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = exec.Command("open", rawURL)
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL)
	default:
		command = exec.Command("xdg-open", rawURL)
	}
	return command.Start()
}
