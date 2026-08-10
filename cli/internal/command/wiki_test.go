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

func chdirForWikiTest(t *testing.T, root string) {
	t.Helper()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(previous); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})
}

func setupWikiIngestRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := wiki.WriteConfig(root, wiki.CloneConfig{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	chdirForWikiTest(t, root)
	return root
}

func TestWikiIngestRejectsCommitWithAgent(t *testing.T) {
	service := testWikiService(func(context.Context, string, ...string) (string, error) {
		t.Fatal("git should not run for mutually exclusive flags")
		return "", nil
	})
	if _, err := executeWiki(t, service, "ingest", "--commit", "--agent", "codex"); err == nil || !strings.Contains(err.Error(), "[commit agent]") {
		t.Fatalf("error = %v, want mutually exclusive flags", err)
	}
}

func TestWikiIngestCommitRejectsDirtyWorktree(t *testing.T) {
	setupWikiIngestRoot(t)
	for _, status := range []string{" M pages/index/page.md\n", "?? pages/new/page.md\n"} {
		t.Run(strings.TrimSpace(status), func(t *testing.T) {
			service := testWikiService(func(_ context.Context, _ string, args ...string) (string, error) {
				if strings.Join(args, " ") != "status --porcelain --untracked-files=all" {
					t.Fatalf("unexpected git call: %s", strings.Join(args, " "))
				}
				return status, nil
			})
			if _, err := executeWiki(t, service, "ingest", "--commit"); err == nil || !strings.Contains(err.Error(), "uncommitted or untracked") {
				t.Fatalf("error = %v, want dirty worktree rejection", err)
			}
		})
	}
}

func TestWikiIngestCommitRejectsUnpushedHead(t *testing.T) {
	setupWikiIngestRoot(t)
	service := testWikiService(func(_ context.Context, _ string, args ...string) (string, error) {
		switch strings.Join(args, " ") {
		case "status --porcelain --untracked-files=all", "pull --ff-only":
			return "", nil
		case "rev-parse HEAD":
			return "local\n", nil
		case "rev-parse refs/remotes/origin/main":
			return "remote\n", nil
		default:
			t.Fatalf("unexpected git call: %s", strings.Join(args, " "))
			return "", nil
		}
	})
	if _, err := executeWiki(t, service, "ingest", "--commit"); err == nil || !strings.Contains(err.Error(), "synchronized with origin/main") {
		t.Fatalf("error = %v, want unpushed HEAD rejection", err)
	}
}

func TestWikiIngestCommitMarksOnlyFirstAndStops(t *testing.T) {
	root := setupWikiIngestRoot(t)
	firstContent := []byte("first")
	secondContent := []byte("second")
	manifest := wiki.SourcesManifest{Version: 1, Documents: []wiki.SourcesManifestEntry{
		{DocumentID: "doc-1", Kind: "wiki-human", Title: "First", Path: "raw/first/page.md", ContentHash: fmt.Sprintf("%x", sha256.Sum256(firstContent))},
		{DocumentID: "doc-2", Kind: "wiki-human", Title: "Second", Path: "raw/second/page.md", ContentHash: fmt.Sprintf("%x", sha256.Sum256(secondContent))},
	}}
	marked := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(wiki.ChatSenders{Senders: []wiki.ChatSender{}})
		case "/api/cli/wiki/sources":
			_ = json.NewEncoder(w).Encode(manifest)
		case "/api/cli/wiki/sources/doc-1/content":
			_, _ = w.Write(firstContent)
		case "/api/cli/wiki/sources/doc-2/content":
			_, _ = w.Write(secondContent)
		case "/api/cli/wiki/agents-md":
			_, _ = io.WriteString(w, "agent instructions")
		case "/api/cli/wiki/sources/ingested":
			var body struct {
				Documents []struct {
					DocumentID string `json:"documentId"`
				} `json:"documents"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode mark request: %v", err)
			}
			for _, doc := range body.Documents {
				marked = append(marked, doc.DocumentID)
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	agentRan := false
	service := testWikiService(func(_ context.Context, _ string, args ...string) (string, error) {
		switch strings.Join(args, " ") {
		case "status --porcelain --untracked-files=all", "pull --ff-only":
			return "", nil
		case "rev-parse HEAD", "rev-parse refs/remotes/origin/main":
			return "synced\n", nil
		default:
			t.Fatalf("unexpected git call: %s", strings.Join(args, " "))
			return "", nil
		}
	})
	service.newClient = func() *wiki.Client {
		client := wiki.NewClientAt(server.URL)
		client.HTTPClient = server.Client()
		return client
	}
	service.runAgent = func(context.Context, string, string) error {
		agentRan = true
		return nil
	}

	output, err := executeWiki(t, service, "ingest", "--commit")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(marked, ",") != "doc-1" {
		t.Fatalf("marked documents = %v, want only doc-1", marked)
	}
	if agentRan || strings.Contains(output, "process ONLY") {
		t.Fatalf("finalization started the next ingest: agentRan=%v output=%q", agentRan, output)
	}
	if !strings.Contains(output, "Marked doc-1 as ingested") || !strings.Contains(output, "1 pending item(s) remain") {
		t.Fatalf("unexpected output: %q", output)
	}
	queue, err := os.ReadFile(filepath.Join(root, "INGEST_QUEUE.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(queue), "doc-1") || !strings.Contains(string(queue), "doc-2") {
		t.Fatalf("queue was not advanced: %s", queue)
	}
}

func clearGitLocalEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_COMMON_DIR",
		"GIT_CONFIG",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_PARAMETERS",
		"GIT_DIR",
		"GIT_GRAFT_FILE",
		"GIT_IMPLICIT_WORK_TREE",
		"GIT_INDEX_FILE",
		"GIT_NO_REPLACE_OBJECTS",
		"GIT_OBJECT_DIRECTORY",
		"GIT_PREFIX",
		"GIT_REPLACE_REF_BASE",
		"GIT_SHALLOW_FILE",
		"GIT_WORK_TREE",
	} {
		if value, exists := os.LookupEnv(name); exists {
			t.Setenv(name, value)
		} else {
			t.Setenv(name, "")
		}
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
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
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(wiki.ChatSenders{Senders: []wiki.ChatSender{}})
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
	if _, err = os.Stat(filepath.Join(target, "AGENTS.md")); !os.IsNotExist(err) {
		t.Fatalf("AGENTS.md should be supplied by the Git snapshot, err = %v", err)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"init -b main",
		"remote add origin " + defaultWikiRemote,
		"fetch origin main",
		"reset --hard refs/remotes/origin/main",
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

func TestWikiCloneBootstrapsUnbornBranchWithRemoteHelper(t *testing.T) {
	clearGitLocalEnvironment(t)
	ctx := context.Background()
	seed := t.TempDir()
	if _, err := runGit(ctx, seed, "init", "-b", "main"); err != nil {
		t.Fatal(err)
	}
	page := filepath.Join(seed, "pages", "welcome", "page.md")
	if err := os.MkdirAll(filepath.Dir(page), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(page, []byte("# Welcome\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(ctx, seed, "add", "pages"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(ctx, seed, "-c", "user.name=GDG Wiki", "-c", "user.email=wiki@gdgs.jp", "commit", "-m", "Wiki snapshot"); err != nil {
		t.Fatal(err)
	}
	commit, err := runGit(ctx, seed, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	commit = strings.TrimSpace(commit)

	bin := t.TempDir()
	helper := filepath.Join(bin, "git-remote-gdg-wiki")
	const helperScript = `#!/bin/sh
pending_fetch=0
while IFS= read -r line; do
	case "$line" in
		capabilities)
			printf 'fetch\n\n'
			;;
		list*)
			git fetch --no-tags --quiet "$TEST_WIKI_SEED" "$TEST_WIKI_COMMIT" || exit 1
			printf '%s refs/heads/main\n\n' "$TEST_WIKI_COMMIT"
			;;
		fetch\ *)
			pending_fetch=1
			;;
		option\ *)
			printf 'ok\n'
			;;
		"")
			if [ "$pending_fetch" -eq 1 ]; then
				printf '\n'
				pending_fetch=0
			fi
			;;
		*)
			exit 1
			;;
	esac
done
`
	if err := os.WriteFile(helper, []byte(helperScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TEST_WIKI_SEED", seed)
	t.Setenv("TEST_WIKI_COMMIT", commit)

	target := filepath.Join(t.TempDir(), "wiki")
	service := testWikiService(runGit)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/cli/wiki/chat-senders":
			_ = json.NewEncoder(w).Encode(wiki.ChatSenders{Senders: []wiki.ChatSender{}})
		case "/api/cli/wiki/sources":
			if got := r.URL.Query().Get("lang"); got != "en" {
				t.Errorf("manifest lang = %q, want en", got)
			}
			_ = json.NewEncoder(w).Encode(wiki.SourcesManifest{Version: 1})
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
	if _, err := executeWiki(t, service, "clone", "--lang", "en", "--remote", "gdg-wiki::test", target); err != nil {
		t.Fatal(err)
	}

	head, err := runGit(ctx, target, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	tracking, err := runGit(ctx, target, "rev-parse", "refs/remotes/origin/main")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(head) != commit || strings.TrimSpace(tracking) != commit {
		t.Fatalf("HEAD = %q, origin/main = %q, want %q", strings.TrimSpace(head), strings.TrimSpace(tracking), commit)
	}
	upstream, err := runGit(ctx, target, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(upstream) != "origin/main" {
		t.Fatalf("upstream = %q, want origin/main", strings.TrimSpace(upstream))
	}
	raw, err := os.ReadFile(filepath.Join(target, "pages", "welcome", "page.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "# Welcome\n" {
		t.Fatalf("page content = %q", raw)
	}
	cfg, err := wiki.ReadConfig(target)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Lang != "en" {
		t.Fatalf("lang = %q, want en", cfg.Lang)
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
