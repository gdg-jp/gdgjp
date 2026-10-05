package img

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImagePatchToJSON(t *testing.T) {
	t.Parallel()

	t.Run("no fields set produces an empty object", func(t *testing.T) {
		t.Parallel()
		body, err := ImagePatch{}.toJSON()
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != "{}" {
			t.Fatalf("toJSON() = %s, want {}", body)
		}
	})

	t.Run("only the flagged fields are included", func(t *testing.T) {
		t.Parallel()
		folderID := 7
		body, err := ImagePatch{SetFolderID: true, FolderID: &folderID}.toJSON()
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]json.RawMessage
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatal(err)
		}
		if _, ok := decoded["slug"]; ok {
			t.Fatalf("unset slug leaked into body: %s", body)
		}
		if _, ok := decoded["chapterId"]; ok {
			t.Fatalf("unset chapterId leaked into body: %s", body)
		}
		if got := string(decoded["folderId"]); got != "7" {
			t.Fatalf("folderId = %s, want 7", got)
		}
	})

	t.Run("a flagged nil value serializes as null, not omitted", func(t *testing.T) {
		t.Parallel()
		body, err := ImagePatch{SetSlug: true, Slug: nil}.toJSON()
		if err != nil {
			t.Fatal(err)
		}
		var decoded map[string]json.RawMessage
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatal(err)
		}
		raw, ok := decoded["slug"]
		if !ok {
			t.Fatalf("slug key missing from body: %s", body)
		}
		if string(raw) != "null" {
			t.Fatalf("slug = %s, want null", raw)
		}
	})
}

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
