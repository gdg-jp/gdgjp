package oauth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
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
	if query.Get("code_challenge") == "" || query.Get("scope") != "openid offline_access "+cliScope {
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
