package oauth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAuthorizationURLUsesPKCES256(t *testing.T) {
	address := authorizationURL("state-value", "verifier-value")
	parsed, err := url.Parse(address)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("client_id") != clientID || query.Get("redirect_uri") != redirectURI {
		t.Fatalf("unexpected OAuth client parameters: %s", query.Encode())
	}
	if query.Get("state") != "state-value" || query.Get("code_challenge_method") != "S256" {
		t.Fatalf("missing state or S256 PKCE: %s", query.Encode())
	}
	wantScope := "openid profile email offline_access " + chaptersScope + " " + cliScope
	if query.Get("code_challenge") == "" || query.Get("scope") != wantScope {
		t.Fatalf("missing PKCE challenge or CLI scope: %s", query.Encode())
	}
}

func TestCallbackHandlerRejectsInvalidState(t *testing.T) {
	result := make(chan string, 1)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8787/callback?state=wrong&code=code", nil)
	response := httptest.NewRecorder()
	callbackHandler("expected", result).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	select {
	case <-result:
		t.Fatal("invalid callback delivered a code")
	default:
	}
}

func TestCallbackHandlerShowsCompletionPage(t *testing.T) {
	result := make(chan string, 1)
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8787/callback?state=expected&code=code", nil)
	response := httptest.NewRecorder()
	callbackHandler("expected", result).ServeHTTP(response, request)
	if response.Header().Get("Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("content type = %q", response.Header().Get("Content-Type"))
	}
	if body := response.Body.String(); !strings.Contains(body, "ログインが完了しました") {
		t.Fatalf("completion page did not contain its heading: %s", body)
	}
	if code := <-result; code != "code" {
		t.Fatalf("callback code = %q, want code", code)
	}
}

func withTestIssuer(t *testing.T, handler http.Handler) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	previous := issuer
	issuer = server.URL
	t.Cleanup(func() { issuer = previous })
}

func TestRequestDeviceAuthorization(t *testing.T) {
	withTestIssuer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/auth/oauth2/device_authorization" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.PostForm.Get("client_id") != clientID || r.PostForm.Get("scope") != loginScope {
			t.Fatalf("unexpected form: %s", r.PostForm.Encode())
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://accounts.example/device","verification_uri_complete":"https://accounts.example/device?user_code=ABCD-1234","expires_in":600,"interval":5}`)
	}))

	response, err := requestDeviceAuthorization(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if response.DeviceCode != "dc" || response.UserCode != "ABCD-1234" || response.Interval != 5 {
		t.Fatalf("unexpected response: %+v", response)
	}
}

func TestRequestDeviceAuthorizationErrorStatus(t *testing.T) {
	withTestIssuer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "invalid_client", http.StatusBadRequest)
	}))
	if _, err := requestDeviceAuthorization(context.Background()); err == nil {
		t.Fatal("expected an error for a non-200 response")
	}
}

func TestPollDeviceToken(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		body        string
		wantErr     string
		wantPollErr string
		wantFatal   bool
	}{
		{
			name:   "success",
			status: http.StatusOK,
			body:   `{"access_token":"at","refresh_token":"rt","token_type":"Bearer"}`,
		},
		{
			name:        "pending",
			status:      http.StatusBadRequest,
			body:        `{"error":"authorization_pending"}`,
			wantPollErr: "authorization_pending",
		},
		{
			name:        "slow_down",
			status:      http.StatusBadRequest,
			body:        `{"error":"slow_down"}`,
			wantPollErr: "slow_down",
		},
		{
			name:        "access_denied",
			status:      http.StatusBadRequest,
			body:        `{"error":"access_denied"}`,
			wantPollErr: "access_denied",
		},
		{
			name:        "expired_token",
			status:      http.StatusBadRequest,
			body:        `{"error":"expired_token"}`,
			wantPollErr: "expired_token",
		},
		{
			name:      "malformed error body is fatal",
			status:    http.StatusBadRequest,
			body:      `not json`,
			wantFatal: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			withTestIssuer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.body)
			}))
			credentials, pollErr, err := pollDeviceToken(context.Background(), "dc")
			if test.wantFatal {
				if err == nil {
					t.Fatal("expected a fatal error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if pollErr != test.wantPollErr {
				t.Fatalf("pollErr = %q, want %q", pollErr, test.wantPollErr)
			}
			if test.wantPollErr == "" && (credentials.AccessToken != "at" || credentials.RefreshToken != "rt") {
				t.Fatalf("unexpected credentials: %+v", credentials)
			}
		})
	}
}

func TestDeviceLoginPollsUntilApproved(t *testing.T) {
	var tokenCalls int
	withTestIssuer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth2/device_authorization":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://accounts.example/device","expires_in":60,"interval":1}`)
		case "/api/auth/oauth2/token":
			tokenCalls++
			if tokenCalls == 1 {
				w.WriteHeader(http.StatusBadRequest)
				fmt.Fprint(w, `{"error":"authorization_pending"}`)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"access_token":"at","refresh_token":"rt","token_type":"Bearer"}`)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))

	credentials, err := DeviceLogin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if credentials.AccessToken != "at" || credentials.RefreshToken != "rt" {
		t.Fatalf("unexpected credentials: %+v", credentials)
	}
	if tokenCalls < 2 {
		t.Fatalf("expected at least 2 poll attempts, got %d", tokenCalls)
	}
}

func TestDeviceLoginReturnsErrorWhenDenied(t *testing.T) {
	withTestIssuer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/oauth2/device_authorization":
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://accounts.example/device","expires_in":60,"interval":1}`)
		case "/api/auth/oauth2/token":
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"error":"access_denied"}`)
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))

	if _, err := DeviceLogin(context.Background()); err == nil {
		t.Fatal("expected an error when the user denies the device login")
	}
}

func TestLikelyHeadless(t *testing.T) {
	tests := []struct {
		name string
		goos string
		env  map[string]string
		want bool
	}{
		{name: "no ssh session", goos: "darwin", env: map[string]string{}, want: false},
		{name: "ssh on darwin has no display concept", goos: "darwin", env: map[string]string{"SSH_TTY": "/dev/ttys0"}, want: true},
		{name: "ssh on windows", goos: "windows", env: map[string]string{"SSH_CONNECTION": "1"}, want: true},
		{
			name: "ssh on linux without a display",
			goos: "linux",
			env:  map[string]string{"SSH_CONNECTION": "1"},
			want: true,
		},
		{
			name: "ssh on linux with X11 forwarding",
			goos: "linux",
			env:  map[string]string{"SSH_CONNECTION": "1", "DISPLAY": ":10"},
			want: false,
		},
		{
			name: "ssh on linux with Wayland forwarding",
			goos: "linux",
			env:  map[string]string{"SSH_CONNECTION": "1", "WAYLAND_DISPLAY": "wayland-0"},
			want: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			getenv := func(key string) string { return test.env[key] }
			if got := likelyHeadless(test.goos, getenv); got != test.want {
				t.Fatalf("likelyHeadless(%q, ...) = %v, want %v", test.goos, got, test.want)
			}
		})
	}
}
