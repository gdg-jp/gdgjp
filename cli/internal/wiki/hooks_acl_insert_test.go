package wiki

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func hooksDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(file), "hooks")
}

func startTestAuthz(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	sock := filepath.Join("/tmp", filepath.Base(dir)+".sock")
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/resolve", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"classes":[{"chapterId":"tokyo","role":"organizer"}],"channelAudience":{"kind":"member"}}`))
	})
	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = ln.Close()
		_ = os.Remove(sock)
	})
	return sock
}

func gitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test",
		"GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeWkFixture(t *testing.T, root, page, baseRev, runID string) {
	t.Helper()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	src := "org-src"
	vis := "organizer"
	chapter := "tokyo"
	state := State{
		Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
			{
				DocumentID:       "doc-1",
				SourceID:         &src,
				Kind:             "source-document",
				Title:            "Secret",
				Path:             "raw/org-src/doc.md",
				ContentHash:      "abc",
				Visibility:       &vis,
				ChapterID:        &chapter,
				ChapterIDPresent: true,
			},
		}},
	}
	if err := WriteState(root, state); err != nil {
		t.Fatal(err)
	}
	if err := WriteACLSources(root, *state.Manifest); err != nil {
		t.Fatal(err)
	}
	if _, err := LockDocument(root, "doc-1", "owner-a", "abc"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".gdgwiki", "ingest-trace"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "raw", "org-src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "raw", "org-src", "doc.md"), []byte("secret raw\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	trace := map[string]any{
		"runId":     runID,
		"baseRev":   baseRev,
		"reads":     []string{"raw/org-src/doc.md"},
		"writes":    []string{},
		"sourceIds": []string{},
	}
	raw, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, ".gdgwiki", "ingest-trace", runID+".json"), append(raw, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(filepath.Join(root, page)), 0o755); err != nil {
		t.Fatal(err)
	}
}

func runWk(t *testing.T, root, sock, runID string, stdin string, args ...string) (string, string, error) {
	t.Helper()
	cmd := exec.Command("node", append([]string{filepath.Join(hooksDir(t), "wk.ts")}, args...)...)
	cmd.Dir = root
	cmd.Stdin = strings.NewReader(stdin)
	cmd.Env = append(os.Environ(),
		"GDG_WIKI_RUN_ID="+runID,
		"GDG_WIKI_LOCK_OWNER=owner-a",
		"XANGI_AUTHZ_NONCE=test-nonce",
		"XANGI_AUTHZ_SOCKET="+sock,
		"GDG_BIN="+writeStubGdg(t),
		"GIT_AUTHOR_NAME=test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test",
		"GIT_COMMITTER_EMAIL=test@example.com",
	)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

func writeStubGdg(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "gdg")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func seedPageRepo(t *testing.T) (root, page, head string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	root = t.TempDir()
	gitIn(t, root, "init", "-b", "main")
	page = filepath.Join("pages", "venues", "umeda", "page.md")
	body := "---\nvisibility: public\n---\noriginal\n"
	if err := os.MkdirAll(filepath.Dir(filepath.Join(root, page)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, page), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", page)
	gitIn(t, root, "commit", "-m", "seed")
	out, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	return root, page, strings.TrimSpace(string(out))
}

func TestWkWriteInsertsAclAndCommitPasses(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-insert"
	writeWkFixture(t, root, page, head, runID)
	sock := startTestAuthz(t)
	next := "---\nvisibility: public\n---\noriginal\nderived from secret\n"
	_, stderr, err := runWk(t, root, sock, runID, next, "write", page)
	if err != nil {
		t.Fatalf("wk write: %v\n%s", err, stderr)
	}
	got, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `<acl src="org-src">`) {
		t.Fatalf("expected inserted span, got:\n%s", got)
	}
	_, stderr, err = runWk(t, root, sock, runID, "", "git", "add", page)
	if err != nil {
		t.Fatalf("wk git add: %v\n%s", err, stderr)
	}
	_, stderr, err = runWk(t, root, sock, runID, "", "git", "commit", "-m", "x")
	if err != nil {
		t.Fatalf("wk git commit: %v\n%s", err, stderr)
	}
	show, err := exec.Command("git", "-C", root, "show", "HEAD:"+page).Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(show), `<acl src="org-src">`) {
		t.Fatalf("committed blob missing tag:\n%s", show)
	}
}

func TestWkWriteRefusesHeadingAndLeavesFileUnchanged(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-heading"
	writeWkFixture(t, root, page, head, runID)
	before, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	sock := startTestAuthz(t)
	next := "---\nvisibility: public\n---\noriginal\n# Secret event\n"
	_, stderr, err := runWk(t, root, sock, runID, next, "write", page)
	if err == nil {
		t.Fatal("expected heading refuse")
	}
	if !strings.Contains(stderr, "org-src") || !strings.Contains(stderr, page) {
		t.Fatalf("stderr = %s", stderr)
	}
	after, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("file changed on refuse:\n%s", after)
	}
}

func TestWkWriteFailClosedWithoutState(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-state"
	writeWkFixture(t, root, page, head, runID)
	if err := os.Remove(StatePath(root)); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	sock := startTestAuthz(t)
	_, stderr, err := runWk(t, root, sock, runID, "---\nvisibility: public\n---\noriginal\nsecret\n", "write", page)
	if err == nil {
		t.Fatal("expected fail closed")
	}
	if !strings.Contains(stderr, "state.json") {
		t.Fatalf("stderr = %s", stderr)
	}
	after, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("file changed when state.json was missing")
	}
}

func TestWkGitCommitTripwireSeesIndexNotWorktree(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-trip"
	writeWkFixture(t, root, page, head, runID)
	untagged := "---\nvisibility: public\n---\noriginal\nsmuggled secret\n"
	if err := os.WriteFile(filepath.Join(root, page), []byte(untagged), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", page)
	tagged := "---\nvisibility: public\n---\noriginal\n<acl src=\"org-src\">\nsmuggled secret\n</acl>\n"
	if err := os.WriteFile(filepath.Join(root, page), []byte(tagged), 0o644); err != nil {
		t.Fatal(err)
	}
	sock := startTestAuthz(t)
	_, stderr, err := runWk(t, root, sock, runID, "", "git", "commit", "-m", "y")
	if err == nil {
		t.Fatal("expected tripwire deny")
	}
	if !strings.Contains(stderr, "gate violation") {
		t.Fatalf("stderr = %s", stderr)
	}
	after, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != tagged {
		t.Fatal("tripwire must not insert into the worktree")
	}
}

func TestWkWriteRefusesMalformedFrontMatter(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-fm"
	writeWkFixture(t, root, page, head, runID)
	before, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	sock := startTestAuthz(t)
	_, stderr, err := runWk(t, root, sock, runID, "no front matter\nsecret\n", "write", page)
	if err == nil {
		t.Fatal("expected malformed front matter refuse")
	}
	if !strings.Contains(stderr, "front matter") {
		t.Fatalf("stderr = %s", stderr)
	}
	after, err := os.ReadFile(filepath.Join(root, page))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("file changed on malformed front matter")
	}
}

func TestWkGitCommitFailOpenWithoutGdg(t *testing.T) {
	root, page, head := seedPageRepo(t)
	runID := "run-opengdg"
	writeWkFixture(t, root, page, head, runID)
	sock := startTestAuthz(t)
	next := "---\nvisibility: public\n---\noriginal\nderived from secret\n"
	if _, stderr, err := runWk(t, root, sock, runID, next, "write", page); err != nil {
		t.Fatalf("wk write: %v\n%s", err, stderr)
	}
	if _, stderr, err := runWk(t, root, sock, runID, "", "git", "add", page); err != nil {
		t.Fatalf("wk git add: %v\n%s", err, stderr)
	}
	cmd := exec.Command("node", filepath.Join(hooksDir(t), "wk.ts"), "git", "commit", "-m", "x")
	cmd.Dir = root
	cmd.Env = append(os.Environ(),
		"GDG_WIKI_RUN_ID="+runID,
		"GDG_WIKI_LOCK_OWNER=owner-a",
		"XANGI_AUTHZ_NONCE=test-nonce",
		"XANGI_AUTHZ_SOCKET="+sock,
		"GDG_BIN=/no-such-gdg-bin",
		"GIT_AUTHOR_NAME=test",
		"GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test",
		"GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("commit should fail open: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "fail open") && !strings.Contains(string(out), "verify-acl failed") {
		t.Fatalf("expected fail-open warning, got %s", out)
	}
}

func TestAclInsertCoreNodeTests(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	cmd := exec.Command("node", "--test", filepath.Join(hooksDir(t), "acl-insert-core.test.ts"))
	cmd.Dir = hooksDir(t)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --test: %v\n%s", err, out)
	}
}
