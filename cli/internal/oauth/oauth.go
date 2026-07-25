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
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

const (
	issuer       = "https://accounts.gdgs.jp"
	clientID     = "gdg-cli"
	redirectURI  = "http://127.0.0.1:8787/callback"
	callbackPath = "/callback"
	cliScope     = "https://gdgs.jp/scopes/cli"
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
		refreshed, err := refresh(ctx, credentials.RefreshToken)
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

func authorizationURL(state, verifier string) string {
	challenge := sha256.Sum256([]byte(verifier))
	query := url.Values{
		"client_id":             {clientID},
		"redirect_uri":          {redirectURI},
		"response_type":         {"code"},
		"scope":                 {"openid offline_access " + cliScope},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	return issuer + "/api/auth/oauth2/authorize?" + query.Encode()
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
			fmt.Fprint(writer, "Login complete. You can close this window.")
		default:
			http.Error(writer, "Login callback was already received.", http.StatusConflict)
		}
	})
}

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

func refresh(ctx context.Context, refreshToken string) (store.Credentials, error) {
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
