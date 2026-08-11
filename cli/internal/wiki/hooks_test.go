package wiki

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureCursorHooksIdempotentAndGitignored(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	// Simulate an old clone gitignore without .cursor/
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("raw/\nINGEST_QUEUE.md\n.gdgwiki/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git", "info"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "info", "exclude"), []byte("# empty\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	updated, err := EnsureCursorHooks(root)
	if err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("first EnsureCursorHooks should write files")
	}
	gitignore, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(gitignore), ".cursor/") {
		t.Fatalf(".gitignore missing .cursor/: %s", gitignore)
	}
	exclude, err := os.ReadFile(filepath.Join(root, ".git", "info", "exclude"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(exclude), ".gitignore") {
		t.Fatalf("exclude missing .gitignore: %s", exclude)
	}
	if _, err = os.Stat(filepath.Join(root, ".cursor", "hooks.json")); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, ".gdgwiki", "hooks", "acl-gate.mjs")); err != nil {
		t.Fatal(err)
	}

	gitignorePath := filepath.Join(root, ".gitignore")
	hooksPath := filepath.Join(root, ".cursor", "hooks.json")
	scriptPath := filepath.Join(root, ".gdgwiki", "hooks", "acl-gate.mjs")
	mtime := func(path string) int64 {
		t.Helper()
		info, statErr := os.Stat(path)
		if statErr != nil {
			t.Fatal(statErr)
		}
		return info.ModTime().UnixNano()
	}
	beforeGitignore := mtime(gitignorePath)
	beforeHooks := mtime(hooksPath)
	beforeScript := mtime(scriptPath)

	updated, err = EnsureCursorHooks(root)
	if err != nil {
		t.Fatal(err)
	}
	if updated {
		t.Fatal("second EnsureCursorHooks should be a no-op")
	}
	if mtime(gitignorePath) != beforeGitignore {
		t.Fatal(".gitignore mtime changed on idempotent EnsureCursorHooks")
	}
	if mtime(hooksPath) != beforeHooks {
		t.Fatal("hooks.json mtime changed on idempotent EnsureCursorHooks")
	}
	if mtime(scriptPath) != beforeScript {
		t.Fatal("acl-gate.mjs mtime changed on idempotent EnsureCursorHooks")
	}
}

func TestEnsureCursorHooksLeavesGitStatusClean(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	root := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
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
	run("init", "-b", "main")
	if err := os.MkdirAll(filepath.Join(root, "pages", "index"), 0o755); err != nil {
		t.Fatal(err)
	}
	page := "---\ngdg_wiki: 1\nid: index\nslug: index\nlanguage: ja\ntitle: Index\ntranslation_status: human\nvisibility: public\ngeneral_role: viewer\n---\nbody\n"
	if err := os.WriteFile(filepath.Join(root, "pages", "index", "page.md"), []byte(page), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "pages")
	run("commit", "-m", "seed")
	// Real clones keep .gitignore untracked via .git/info/exclude (never committed).
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("raw/\nINGEST_QUEUE.md\n.gdgwiki/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}

	if _, err := EnsureCursorHooks(root); err != nil {
		t.Fatal(err)
	}
	status := exec.Command("git", "status", "--porcelain", "--untracked-files=all")
	status.Dir = root
	out, err := status.CombinedOutput()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(out)) != "" {
		t.Fatalf("git status not clean after EnsureCursorHooks:\n%s", out)
	}
}
