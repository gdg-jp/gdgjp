package img

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetErrorEnvelope(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_token"})
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).Get(context.Background(), "token", "abcd1234")
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("err = %#v, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusUnauthorized {
		t.Fatalf("StatusCode = %d", httpErr.StatusCode)
	}
	if httpErr.Message != "invalid_token" {
		t.Fatalf("Message = %q, want %q", httpErr.Message, "invalid_token")
	}
	if want := "img request failed (401): invalid_token"; httpErr.Error() != want {
		t.Fatalf("Error() = %q, want %q", httpErr.Error(), want)
	}
}

func TestGetErrorNonJSONFallback(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("  upstream timeout  "))
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).Get(context.Background(), "token", "abcd1234")
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("err = %#v, want *HTTPError", err)
	}
	if httpErr.Message != "upstream timeout" {
		t.Fatalf("Message = %q, want %q", httpErr.Message, "upstream timeout")
	}
}
