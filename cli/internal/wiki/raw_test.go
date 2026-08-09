package wiki

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
)

func TestIngestPromptRequiresFinalizationAfterPush(t *testing.T) {
	prompt := IngestPrompt("/tmp/wiki", 1)
	push := strings.Index(prompt, "commit and git push")
	finalize := strings.Index(prompt, "gdg wiki ingest --commit")
	if push < 0 || finalize < 0 || finalize < push {
		t.Fatalf("prompt does not order push before finalization:\n%s", prompt)
	}
}

func TestRawLocalPathStaysUnderRaw(t *testing.T) {
	root := t.TempDir()
	path, err := rawLocalPath(root, "raw/source-1/assets/photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(root, "raw", "source-1", "assets", "photo.png") {
		t.Fatalf("path = %q", path)
	}

	for _, input := range []string{"pages/page.md", "raw/../pages/page.md", "raw"} {
		if _, err := rawLocalPath(root, input); err == nil {
			t.Errorf("rawLocalPath(%q) succeeded", input)
		}
	}
}

func TestPullRawReconcilesManifestUsingCloneLanguage(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "en"}); err != nil {
		t.Fatal(err)
	}
	for path, content := range map[string]string{
		"raw/source/keep.md":               "keep",
		"raw/source/renamed-old.md":        "old",
		"raw/source/permission-removed.md": "private",
	} {
		fullPath := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	external := filepath.Join(root, "outside.txt")
	if err := os.WriteFile(external, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	staleLink := filepath.Join(root, "raw", "source", "stale-link")
	if err := os.Symlink(external, staleLink); err != nil {
		t.Fatal(err)
	}

	newContent := []byte("new English content")
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "keep", Path: "raw/source/keep.md", ContentHash: digest([]byte("keep"))},
		{DocumentID: "new", Path: "raw/source/renamed-new.md", ContentHash: digest(newContent)},
	}}
	contentRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/sources":
			if got := r.URL.Query().Get("lang"); got != "en" {
				t.Errorf("manifest lang = %q, want en", got)
			}
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/new/content":
			contentRequests++
			if got := r.URL.Query().Get("lang"); got != "en" {
				t.Errorf("content lang = %q, want en", got)
			}
			_, _ = w.Write(newContent)
		case "/api/cli/wiki/agents-md":
			_, _ = io.WriteString(w, "agent instructions")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()
	gotManifest, err := PullRaw(context.Background(), root, client, "token")
	if err != nil {
		t.Fatal(err)
	}
	if len(gotManifest.Documents) != len(manifest.Documents) {
		t.Fatalf("returned manifest has %d documents", len(gotManifest.Documents))
	}
	if contentRequests != 1 {
		t.Fatalf("content requests = %d, want 1", contentRequests)
	}
	for _, stale := range []string{
		"raw/source/renamed-old.md",
		"raw/source/permission-removed.md",
		"raw/source/stale-link",
	} {
		if _, err := os.Lstat(filepath.Join(root, filepath.FromSlash(stale))); !os.IsNotExist(err) {
			t.Errorf("stale path %s was not removed", stale)
		}
	}
	if raw, err := os.ReadFile(filepath.Join(root, "raw", "source", "renamed-new.md")); err != nil || string(raw) != string(newContent) {
		t.Fatalf("new raw content = %q, err = %v", raw, err)
	}
	if info, err := os.Stat(filepath.Join(root, "raw", "source")); err != nil || !info.IsDir() {
		t.Fatalf("raw directory was not preserved: %v", err)
	}
	if raw, err := os.ReadFile(external); err != nil || string(raw) != "outside" {
		t.Fatalf("symlink target changed: %q, err = %v", raw, err)
	}
}

func TestPullRawValidatesAllManifestPathsBeforeMutation(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	stalePath := filepath.Join(root, "raw", "source", "stale.md")
	if err := os.MkdirAll(filepath.Dir(stalePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stalePath, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "valid", Path: "raw/source/new.md", ContentHash: digest([]byte("new"))},
		{DocumentID: "invalid", Path: "raw/../pages/page.md", ContentHash: digest([]byte("bad"))},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/wiki/sources" {
			t.Errorf("unexpected request after invalid manifest: %s", r.URL.Path)
			http.Error(w, "unexpected", http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(manifest)
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	_, err := PullRaw(context.Background(), root, client, "token")
	if err == nil || !strings.Contains(err.Error(), "must stay under raw") {
		t.Fatalf("PullRaw error = %v", err)
	}
	if raw, readErr := os.ReadFile(stalePath); readErr != nil || string(raw) != "stale" {
		t.Fatalf("stale file changed before validation: %q, err = %v", raw, readErr)
	}
	if _, statErr := os.Stat(filepath.Join(root, "raw", "source", "new.md")); !os.IsNotExist(statErr) {
		t.Fatalf("valid entry was written before full validation: %v", statErr)
	}
}

func TestPullRawRejectsContentThatDoesNotMatchManifestHash(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "en"}); err != nil {
		t.Fatal(err)
	}
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
		{DocumentID: "changed", Path: "raw/source/changed.md", ContentHash: digest([]byte("manifest bytes"))},
	}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/changed/content":
			_, _ = io.WriteString(w, "newer bytes")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	_, err := PullRaw(context.Background(), root, client, "token")
	if err == nil || !strings.Contains(err.Error(), "content hash mismatch") {
		t.Fatalf("PullRaw error = %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "raw", "source", "changed.md")); !os.IsNotExist(statErr) {
		t.Fatalf("mismatched content was written: %v", statErr)
	}
}
