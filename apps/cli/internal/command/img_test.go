package command

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func executeImg(t *testing.T, credentials store.CredentialStore, args ...string) (string, error) {
	t.Helper()
	command := newImgCommand(credentials)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	command.SilenceUsage = true
	command.SilenceErrors = true
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func testImageFile(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.jpg")
	if err := os.WriteFile(path, []byte("fake-jpeg-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func defaultImgCredentialStore() *memoryCredentialStore {
	return &memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	}}
}

func TestImgList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/images" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("chapterId") != "5" || r.URL.Query().Get("limit") != "10" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		if r.Header.Get("Authorization") != "Bearer access-token" {
			t.Fatalf("authorization = %s", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"images":     []any{},
			"nextCursor": nil,
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "list", "--chapter-id", "5", "--limit", "10")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"images": []`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgGet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "get", "abcd1234")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "abcd1234"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgUpload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/images" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if r.MultipartForm.Value["chapterId"][0] != "5" {
			t.Fatalf("chapterId = %#v", r.MultipartForm.Value["chapterId"])
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		if header.Filename != "test.jpg" {
			t.Fatalf("filename = %s", header.Filename)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "abcd1234", "url": "https://img.gdgs.jp/abcd1234"})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "upload", testImageFile(t), "--chapter-id", "5")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "abcd1234"`) || !strings.Contains(out, `"url": "https://img.gdgs.jp/abcd1234"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgReplace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "abcd1234", "url": "https://img.gdgs.jp/abcd1234", "updatedAt": 42})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "replace", "abcd1234", testImageFile(t))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"updatedAt": 42`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgMobile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/images/abcd1234/mobile" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "abcd1234", "updatedAt": 42})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "mobile", "abcd1234", testImageFile(t))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"updatedAt": 42`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgSlug(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Slug *string `json:"slug"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Slug == nil || *body.Slug != "my-pic" {
			t.Fatalf("slug = %#v, want \"my-pic\"", body.Slug)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"slug": "my-pic", "r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "slug", "abcd1234", "my-pic")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"slug": "my-pic"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgSlugClear(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Slug *string `json:"slug"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Slug != nil {
			t.Fatalf("slug = %#v, want null", body.Slug)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"slug": nil, "r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "slug", "abcd1234", "--clear")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "abcd1234"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgMove(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			FolderID  *int    `json:"folderId"`
			ChapterID *int    `json:"chapterId"`
			Slug      *string `json:"slug"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.FolderID == nil || *body.FolderID != 7 {
			t.Fatalf("folderId = %#v, want 7", body.FolderID)
		}
		if body.ChapterID != nil || body.Slug != nil {
			t.Fatalf("unrelated fields leaked into move: chapterId=%#v slug=%#v", body.ChapterID, body.Slug)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"folderId": 7, "slug": nil, "r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "move", "abcd1234", "--folder-id", "7")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"folderId": 7`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgMoveClear(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			FolderID *int `json:"folderId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.FolderID != nil {
			t.Fatalf("folderId = %#v, want null", body.FolderID)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"folderId": nil, "slug": nil, "r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "move", "abcd1234", "--clear")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "abcd1234"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgMoveRejectsFolderIDAndClearTogether(t *testing.T) {
	out, err := executeImg(t, defaultImgCredentialStore(), "move", "abcd1234", "--folder-id", "7", "--clear")
	if err == nil {
		t.Fatalf("expected error, output = %s", out)
	}
}

func TestImgShare(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			ChapterID *int `json:"chapterId"`
			FolderID  *int `json:"folderId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.ChapterID == nil || *body.ChapterID != 9 {
			t.Fatalf("chapterId = %#v, want 9", body.ChapterID)
		}
		if body.FolderID != nil {
			t.Fatalf("folderId leaked into share: %#v", body.FolderID)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 9,
				"folderId": nil, "slug": nil, "r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "share", "abcd1234", "--chapter-id", "9")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"chapterId": 9`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgFoldersList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/folders" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"folders": []any{}, "nextCursor": nil})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "folders", "list")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"folders": []`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgFoldersListWithFilters(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/cli/v1/folders" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("chapterId") != "5" || q.Get("limit") != "10" || q.Get("cursor") != "abc" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"folders":    []any{},
			"nextCursor": "next-page",
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "folders", "list",
		"--chapter-id", "5", "--limit", "10", "--cursor", "abc")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"nextCursor": "next-page"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgFoldersCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/folders" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Name      string `json:"name"`
			ChapterID *int   `json:"chapterId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Name != "logos" || body.ChapterID == nil || *body.ChapterID != 5 {
			t.Fatalf("body = %#v", body)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"folder": map[string]any{
				"id": 1, "chapterId": 5, "name": "logos", "createdByUserId": "u",
				"imageCount": 0, "createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "folders", "create", "--name", "logos", "--chapter-id", "5")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"name": "logos"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgFoldersDelete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/cli/v1/folders/3" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 3, "deleted": true})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "folders", "delete", "3")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Fatalf("output = %s", out)
	}
}

func TestImgDelete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/cli/v1/images/abcd1234" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "abcd1234", "deleted": true})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

	out, err := executeImg(t, defaultImgCredentialStore(), "delete", "abcd1234")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Fatalf("output = %s", out)
	}
}

// TestImgGetRetriesOnceOn401 pins the 401-refresh-retry-once path (cliutil.WithToken)
// for the img command tree: a stale access token gets one refresh, then the
// original request is retried exactly once with the fresh token.
func TestImgGetRetriesOnceOn401(t *testing.T) {
	var tokensSeen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		tokensSeen = append(tokensSeen, token)
		if token != "new-access" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "expired"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"image": map[string]any{
				"id": "abcd1234", "userId": "u", "accountId": "a", "chapterId": 1,
				"r2Key": "k", "contentType": "image/jpeg", "byteSize": 1,
				"width": nil, "height": nil, "filename": nil,
				"mobileR2Key": nil, "mobileContentType": nil, "mobileByteSize": nil,
				"mobileFilename": nil, "mobileUpdatedAt": nil,
				"createdAt": 0, "updatedAt": 0,
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_IMG_URL", server.URL)

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
	out, err := executeImg(t, credentials, "get", "abcd1234")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "abcd1234"`) {
		t.Fatalf("output = %s", out)
	}
	if len(tokensSeen) != 2 || tokensSeen[0] != "old-access" || tokensSeen[1] != "new-access" {
		t.Fatalf("tokens seen = %#v, want exactly [old-access new-access] (one retry)", tokensSeen)
	}
	if credentials.credentials.AccessToken != "new-access" {
		t.Fatalf("saved credentials = %#v, want the refreshed access token", credentials.credentials)
	}
}
