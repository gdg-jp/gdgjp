package sns

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetPostErrorEnvelope(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_token"})
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).GetPost(context.Background(), "token", "post_1")
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
	if want := "sns request failed (401): invalid_token"; httpErr.Error() != want {
		t.Fatalf("Error() = %q, want %q", httpErr.Error(), want)
	}
}

func TestGetPostErrorNonJSONFallback(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("  upstream timeout  "))
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).GetPost(context.Background(), "token", "post_1")
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("err = %#v, want *HTTPError", err)
	}
	if httpErr.Message != "upstream timeout" {
		t.Fatalf("Message = %q, want %q", httpErr.Message, "upstream timeout")
	}
}

// TestPublishPostBadGatewayCarriesBody pins the publish contract: a 502 is not
// an error from PublishPost — it returns the persisted post body plus the 502
// status so the command can print the post and then exit non-zero.
func TestPublishPostBadGatewayCarriesBody(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"failed","failureReason":"x rejected"}}`))
	}))
	t.Cleanup(server.Close)

	result, err := NewClientAt(server.URL).PublishPost(context.Background(), "token", "post_1")
	if err != nil {
		t.Fatalf("err = %v, want nil (502 body is not an error)", err)
	}
	if result.Status != http.StatusBadGateway {
		t.Fatalf("Status = %d, want 502", result.Status)
	}
	var envelope struct {
		Post struct {
			Status        string `json:"status"`
			FailureReason string `json:"failureReason"`
		} `json:"post"`
	}
	if err := json.Unmarshal(result.Body, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Post.Status != "failed" || envelope.Post.FailureReason != "x rejected" {
		t.Fatalf("post = %#v", envelope.Post)
	}
}

func TestPublishPostConflictIsError(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "already published"})
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).PublishPost(context.Background(), "token", "post_1")
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("err = %#v, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusConflict || httpErr.Message != "already published" {
		t.Fatalf("httpErr = %#v", httpErr)
	}
}
