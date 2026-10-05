package accounts

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateOIDCClientSendsBearerCredentialsAndJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/auth/oauth2/create-client" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer access-token" {
			t.Fatalf("Authorization = %q", got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"client_name":"Example"`) ||
			!strings.Contains(string(body), `"redirect_uris":["https://example.com/callback"]`) {
			t.Fatalf("unexpected body: %s", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"client_id":"client-1","client_secret":"secret"}`))
	}))
	defer server.Close()

	client := NewAccountsClient(server.URL, server.Client())
	result, err := client.CreateOIDCClient(context.Background(), "access-token", CreateClientInput{
		Name:         "Example",
		RedirectURIs: []string{"https://example.com/callback"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(result), `{"client_id":"client-1","client_secret":"secret"}`; got != want {
		t.Fatalf("result = %s, want %s", got, want)
	}
}

func TestClientReturnsAPIDetailsOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"error":"invalid_request","error_description":"redirect_uris is required"}`))
	}))
	defer server.Close()

	err := NewAccountsClient(server.URL, server.Client()).DeleteOIDCClient(
		context.Background(),
		"access-token",
		"client-1",
	)
	if err == nil || !strings.Contains(err.Error(), "redirect_uris is required") {
		t.Fatalf("error = %v", err)
	}
	var httpError *HTTPError
	if !errors.As(err, &httpError) || httpError.StatusCode != http.StatusBadRequest {
		t.Fatalf("HTTP error = %#v", httpError)
	}
}

func TestVendWorkspaceTokenSendsBearerAndTargetUserID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/agents/google-workspace-token" {
			t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer svc-access-token" {
			t.Fatalf("Authorization = %q", got)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"userId":"target-sub"`) {
			t.Fatalf("unexpected body: %s", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"access_token":"short-lived-token","expires_in":3599}`))
	}))
	defer server.Close()

	client := NewAccountsClient(server.URL, server.Client())
	result, err := client.VendWorkspaceToken(context.Background(), "svc-access-token", "target-sub")
	if err != nil {
		t.Fatal(err)
	}
	if result.AccessToken != "short-lived-token" || result.ExpiresIn != 3599 {
		t.Fatalf("result = %#v", result)
	}
}

func TestVendWorkspaceTokenReturnsAPIDetailsOnFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write([]byte(`{"error":"not_connected"}`))
	}))
	defer server.Close()

	_, err := NewAccountsClient(server.URL, server.Client()).VendWorkspaceToken(
		context.Background(),
		"svc-access-token",
		"target-sub",
	)
	if err == nil || !strings.Contains(err.Error(), "not_connected") {
		t.Fatalf("error = %v", err)
	}
	var httpError *HTTPError
	if !errors.As(err, &httpError) || httpError.StatusCode != http.StatusNotFound {
		t.Fatalf("HTTP error = %#v", httpError)
	}
}

func TestVendWorkspaceTokenRejectsMalformedSuccessResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "empty object", body: `{}`},
		{name: "empty access token", body: `{"access_token":"","expires_in":3599}`},
		{name: "non-positive expiry", body: `{"access_token":"short-lived-token","expires_in":0}`},
		{name: "negative expiry", body: `{"access_token":"short-lived-token","expires_in":-1}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()

			result, err := NewAccountsClient(server.URL, server.Client()).VendWorkspaceToken(
				context.Background(),
				"svc-access-token",
				"target-sub",
			)
			if err == nil {
				t.Fatalf("expected an error, got result = %#v", result)
			}
			if !strings.Contains(err.Error(), "malformed token response") {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
