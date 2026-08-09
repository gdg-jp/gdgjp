package command

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

type gitCall struct {
	directory string
	args      []string
}

type memoryCredentialStore struct {
	credentials store.Credentials
}

func (s *memoryCredentialStore) Save(credentials store.Credentials) error {
	s.credentials = credentials
	return nil
}

func (s *memoryCredentialStore) Load() (store.Credentials, error) {
	return s.credentials, nil
}

func (s *memoryCredentialStore) Delete() error {
	s.credentials = store.Credentials{}
	return nil
}

func testWikiService(run gitRunner) *wikiService {
	return &wikiService{
		runGit:        run,
		executable:    os.Executable,
		installHelper: func(string) (string, error) { return "git-remote-gdg-wiki", nil },
		credentials: &memoryCredentialStore{credentials: store.Credentials{
			AccessToken:  "access-token",
			RefreshToken: "refresh-token",
		}},
		newClient: wiki.NewClient,
		runAgent:  func(context.Context, string, string) error { return nil },
	}
}

func executeWiki(t *testing.T, service *wikiService, args ...string) (string, error) {
	t.Helper()
	command := newWikiCommandWithService(service)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func TestWikiCloneUsesGDGWikiRemote(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "wiki")
	var calls []gitCall
	var installed string
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		return "", nil
	})
	service.installHelper = func(executable string) (string, error) {
		installed = executable
		return "git-remote-gdg-wiki", nil
	}
	rawContent := []byte("raw Japanese content")
	rawHash := sha256.Sum256(rawContent)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer access-token" {
			t.Errorf("Authorization = %q", got)
		}
		switch r.URL.Path {
		case "/api/cli/wiki/sources":
			if got := r.URL.Query().Get("lang"); got != "ja" {
				t.Errorf("manifest lang = %q, want ja", got)
			}
			_ = json.NewEncoder(w).Encode(wiki.SourcesManifest{
				Version: 1,
				Documents: []wiki.SourcesManifestEntry{{
					DocumentID:  "document-1",
					Kind:        "source-document",
					Title:       "Source",
					Path:        "raw/source/document.md",
					ContentHash: fmt.Sprintf("%x", rawHash),
				}},
			})
		case "/api/cli/wiki/sources/document-1/content":
			if got := r.URL.Query().Get("lang"); got != "ja" {
				t.Errorf("content lang = %q, want ja", got)
			}
			_, _ = w.Write(rawContent)
		case "/api/cli/wiki/agents-md":
			_, _ = io.WriteString(w, "agent instructions")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	service.newClient = func() *wiki.Client {
		client := wiki.NewClientAt(server.URL)
		client.HTTPClient = server.Client()
		return client
	}

	output, err := executeWiki(t, service, "clone", "--lang", "ja", target)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output, "lang=ja") {
		t.Fatalf("output = %q", output)
	}
	if strings.Contains(output, "re-clone") || strings.Contains(output, "bilingual") {
		t.Fatalf("unexpected compatibility warning: %q", output)
	}
	if !strings.Contains(output, "raw sources") {
		t.Fatalf("expected raw synchronization confirmation, got %q", output)
	}
	if installed == "" {
		t.Fatal("clone did not ensure the Git helper")
	}
	cfg, err := wiki.ReadConfig(target)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Lang != "ja" {
		t.Fatalf("lang = %q", cfg.Lang)
	}
	raw, err := os.ReadFile(filepath.Join(target, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "raw/") {
		t.Fatalf("gitignore = %q", raw)
	}
	if raw, err = os.ReadFile(filepath.Join(target, "raw", "source", "document.md")); err != nil || string(raw) != string(rawContent) {
		t.Fatalf("raw content = %q, err = %v", raw, err)
	}
	if raw, err = os.ReadFile(filepath.Join(target, "AGENTS.md")); err != nil || string(raw) != "agent instructions" {
		t.Fatalf("AGENTS.md = %q, err = %v", raw, err)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"init -b main",
		"remote add origin " + defaultWikiRemote,
		"pull origin main",
		"config branch.main.remote origin",
		"config branch.main.merge refs/heads/main",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Git calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestWikiCloneDoesNotReportSuccessWhenRawSyncFails(t *testing.T) {
	target := filepath.Join(t.TempDir(), "wiki")
	service := testWikiService(func(_ context.Context, _ string, _ ...string) (string, error) {
		return "", nil
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "raw unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	service.newClient = func() *wiki.Client {
		client := wiki.NewClientAt(server.URL)
		client.HTTPClient = server.Client()
		return client
	}

	output, err := executeWiki(t, service, "clone", target)
	if err == nil || !strings.Contains(err.Error(), "sync raw Wiki content") {
		t.Fatalf("clone error = %v", err)
	}
	if strings.Contains(output, "Cloned Wiki") {
		t.Fatalf("unexpected success output: %q", output)
	}
}

func TestWikiInitConfiguresRemoteWithoutFetchingOrCommitting(t *testing.T) {
	root := t.TempDir()
	var calls []gitCall
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		switch strings.Join(args, " ") {
		case "rev-parse --is-inside-work-tree", "remote get-url origin":
			return "", errors.New("missing")
		default:
			return "", nil
		}
	})

	output, err := executeWiki(t, service, "init", root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output, "git pull") {
		t.Fatalf("unexpected output: %q", output)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"rev-parse --is-inside-work-tree",
		"init -b main",
		"remote get-url origin",
		"remote add origin " + defaultWikiRemote,
		"config branch.main.remote origin",
		"config branch.main.merge refs/heads/main",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Git calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestFindWikiRootRequiresCloneConfig(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deeper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := wiki.WriteConfig(root, wiki.CloneConfig{Lang: "en"}); err != nil {
		t.Fatal(err)
	}

	got, err := findWikiRoot(nested)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("root = %q, want %q", got, root)
	}
}

func TestFindWikiRootRejectsUnrelatedGitRepository(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := findWikiRoot(nested); err == nil || !strings.Contains(err.Error(), ".gdgwiki/config.json") {
		t.Fatalf("findWikiRoot error = %v", err)
	}
}

func TestFindWikiRootRejectsMalformedCloneConfig(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(wiki.ConfigPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wiki.ConfigPath(root), []byte(`{"lang":"fr"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := findWikiRoot(root); err == nil || !strings.Contains(err.Error(), "invalid Wiki clone language") {
		t.Fatalf("findWikiRoot error = %v", err)
	}
}
