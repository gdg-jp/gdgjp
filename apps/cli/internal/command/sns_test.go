package command

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func executeSns(t *testing.T, credentials store.CredentialStore, args ...string) (string, error) {
	t.Helper()
	command := newSnsCommand(credentials)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	command.SilenceUsage = true
	command.SilenceErrors = true
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func defaultSnsCredentialStore() *memoryCredentialStore {
	return &memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	}}
}

func testSnsImageFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "photo.jpg")
	if err := os.WriteFile(path, []byte("fake-jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSnsPostsList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/posts" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("chapterId") != "5" || q.Get("status") != "scheduled" || q.Get("limit") != "10" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		if r.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("authorization = %s", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"posts":[],"nextCursor":null}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"posts", "list", "--chapter-id", "5", "--status", "scheduled", "--limit", "10")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"nextCursor": null`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsPostsCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/posts" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["chapterId"] != float64(5) || payload["xAccountId"] != "xa_1" ||
			payload["text"] != "hello" || payload["scheduledAt"] != "2026-09-01T00:00:00Z" ||
			payload["condition"] != "scheduled" {
			t.Fatalf("payload = %#v", payload)
		}
		handles, ok := payload["tagHandles"].([]any)
		if !ok || len(handles) != 2 || handles[0] != "gdg" {
			t.Fatalf("tagHandles = %#v", payload["tagHandles"])
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"scheduled"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"posts", "create", "--chapter-id", "5", "--x-account-id", "xa_1", "--text", "hello",
		"--scheduled-at", "2026-09-01T00:00:00Z", "--condition", "scheduled",
		"--tag-handle", "gdg", "--tag-handle", "japan")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "post_1"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsPostsGet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/posts/post_1" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"scheduled"},"media":[{"id":"m_1"}]}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(), "posts", "get", "post_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "m_1"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsPostsUpdateRequiresAField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	_, err := executeSns(t, defaultSnsCredentialStore(), "posts", "update", "post_1")
	if err == nil || !strings.Contains(err.Error(), "specify at least one field") {
		t.Fatalf("err = %v", err)
	}
}

func TestSnsPostsPublishSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/posts/post_1/publish" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"published","publishedXPostId":"9001"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(), "posts", "publish", "post_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"status": "published"`) {
		t.Fatalf("output = %s", out)
	}
}

// TestSnsPostsPublishBadGateway is the pinned regression: a 502 from the X API
// must print the persisted post (with its failureReason) to stdout and then
// exit non-zero — never a silent exit 0 with no output.
func TestSnsPostsPublishBadGateway(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"failed","failureReason":"duplicate content"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(), "posts", "publish", "post_1")
	if err == nil {
		t.Fatalf("err = nil, want a non-zero exit on 502; output = %s", out)
	}
	if !strings.Contains(out, `"failureReason": "duplicate content"`) {
		t.Fatalf("output must still carry the persisted post; output = %s", out)
	}
}

func TestSnsMediaAdd(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/posts/post_1/media" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if r.MultipartForm.Value["sortOrder"][0] != "2" {
			t.Fatalf("sortOrder = %#v", r.MultipartForm.Value["sortOrder"])
		}
		if r.MultipartForm.Value["altText"][0] != "a cat" {
			t.Fatalf("altText = %#v", r.MultipartForm.Value["altText"])
		}
		_, header, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		if header.Filename != "photo.jpg" {
			t.Fatalf("filename = %s", header.Filename)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"media":{"id":"m_1"},"post":{"id":"post_1"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"media", "add", "post_1", testSnsImageFile(t), "--sort-order", "2", "--alt", "a cat")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "m_1"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsMediaDelete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/cli/v1/media/m_1" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"id":"m_1","deleted":true,"post":{"id":"post_1"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(), "media", "delete", "m_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsXAccountsList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/x-accounts" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("chapterId") != "5" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"accounts":[{"id":"xa_1","username":"gdgjp"}]}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(), "x-accounts", "list", "--chapter-id", "5")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "xa_1"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsXAccountsRevoke(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/cli/v1/x-accounts/xa_1" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["xUserId"] != "u-123" {
			t.Fatalf("payload = %#v", payload)
		}
		_, _ = w.Write([]byte(`{"id":"xa_1","revoked":true}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"x-accounts", "revoke", "xa_1", "--x-user-id", "u-123")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"revoked": true`) {
		t.Fatalf("output = %s", out)
	}
}

func TestSnsContributorsAdd(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/contributors" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["chapterId"] != float64(5) || payload["userEmail"] != "a@b.com" {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"chapterId":5,"userEmail":"a@b.com"}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"contributors", "add", "--chapter-id", "5", "--email", "a@b.com")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"userEmail": "a@b.com"`) {
		t.Fatalf("output = %s", out)
	}
}

// TestSnsContributorsRemove pins the deliberately query-param-based shape: no
// positional id, DELETE with chapterId + userEmail query parameters.
func TestSnsContributorsRemove(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/cli/v1/contributors" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("chapterId") != "5" || q.Get("userEmail") != "a@b.com" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"deleted":true}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	out, err := executeSns(t, defaultSnsCredentialStore(),
		"contributors", "remove", "--chapter-id", "5", "--email", "a@b.com")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Fatalf("output = %s", out)
	}
}

// TestSnsPostsGetRetriesOnceOn401 pins the 401-refresh-retry-once path
// (cliutil.WithToken) for the sns command tree.
func TestSnsPostsGetRetriesOnceOn401(t *testing.T) {
	var tokensSeen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		tokensSeen = append(tokensSeen, token)
		if token != "new-access" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "expired"})
			return
		}
		_, _ = w.Write([]byte(`{"post":{"id":"post_1","status":"scheduled"},"media":[]}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_SNS_URL", server.URL)

	restore := cliutil.SetRefreshForTesting(func(_ context.Context, refreshToken string) (store.Credentials, error) {
		if refreshToken != "refresh-token" {
			t.Fatalf("refresh token = %q", refreshToken)
		}
		return store.Credentials{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
	})
	t.Cleanup(restore)

	credentials := &memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "old-access",
		RefreshToken: "refresh-token",
	}}
	out, err := executeSns(t, credentials, "posts", "get", "post_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "post_1"`) {
		t.Fatalf("output = %s", out)
	}
	if len(tokensSeen) != 2 || tokensSeen[0] != "old-access" || tokensSeen[1] != "new-access" {
		t.Fatalf("tokens seen = %#v, want exactly [old-access new-access] (one retry)", tokensSeen)
	}
	if credentials.credentials.AccessToken != "new-access" {
		t.Fatalf("saved credentials = %#v, want the refreshed access token", credentials.credentials)
	}
}
