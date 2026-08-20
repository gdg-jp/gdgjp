package wiki

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func installInspectableAgentRoot(t *testing.T) (home, agentRoot string) {
	t.Helper()
	home = t.TempDir()
	t.Setenv("HOME", home)
	agentRoot = t.TempDir()
	lib := filepath.Join(agentRoot, "lib")
	bin := filepath.Join(agentRoot, "bin")
	if err := os.MkdirAll(lib, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	writes := map[string][]byte{
		filepath.Join(lib, aclGateFileName):       aclGateScript,
		filepath.Join(lib, wkFileName):            wkScript,
		filepath.Join(lib, aclCoreFileName):       aclCoreScript,
		filepath.Join(lib, "shell-allowlist.ts"):  shellAllowlistScript,
		filepath.Join(lib, "commit-tripwire.ts"):  commitTripwireScript,
		filepath.Join(lib, aclBundleFileName):     []byte("export {}\n"),
		filepath.Join(agentRoot, packageJSONName): hooksPackageJSON,
		filepath.Join(bin, wkLauncherName):        []byte("#!/bin/sh\nexec node \"$(dirname \"$0\")/../lib/wk.ts\" \"$@\"\n"),
	}
	for path, body := range writes {
		if err := os.WriteFile(path, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cursorDir := filepath.Join(home, ".cursor")
	if err := os.MkdirAll(cursorDir, 0o755); err != nil {
		t.Fatal(err)
	}
	hooks := map[string]any{
		"version": 1,
		"hooks": map[string]any{
			"preToolUse": []map[string]any{
				{
					"command":    "node " + filepath.Join(lib, aclGateFileName) + " " + filepath.Join(bin, wkLauncherName),
					"timeout":    10,
					"failClosed": true,
				},
			},
		},
	}
	raw, err := json.MarshalIndent(hooks, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(cursorDir, cursorHooksJSON), append(raw, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	return home, agentRoot
}

func TestEnsureCursorHooksIdempotentAndGitignored(t *testing.T) {
	installInspectableAgentRoot(t)
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("raw/\nINGEST_QUEUE.md\n.gdgwiki/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".git", "info"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".git", "info", "exclude"), []byte("# empty\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	updated, warnings, err := EnsureCursorHooks(root)
	if err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("first EnsureCursorHooks should refresh .gitignore")
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %#v", warnings)
	}
	gitignore, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(gitignore), ".cursor/") {
		t.Fatalf(".gitignore missing .cursor/: %s", gitignore)
	}
	if _, err = os.Stat(filepath.Join(root, ".cursor", "hooks.json")); !os.IsNotExist(err) {
		t.Fatalf("clone must not receive .cursor/hooks.json: %v", err)
	}
	if _, err = os.Stat(filepath.Join(root, ".gdgwiki", "hooks", "acl-gate.ts")); !os.IsNotExist(err) {
		t.Fatalf("clone must not receive hook scripts: %v", err)
	}

	gitignorePath := filepath.Join(root, ".gitignore")
	mtime := func(path string) int64 {
		t.Helper()
		info, statErr := os.Stat(path)
		if statErr != nil {
			t.Fatal(statErr)
		}
		return info.ModTime().UnixNano()
	}
	beforeGitignore := mtime(gitignorePath)
	updated, warnings, err = EnsureCursorHooks(root)
	if err != nil {
		t.Fatal(err)
	}
	if updated {
		t.Fatal("second EnsureCursorHooks should be a no-op")
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %#v", warnings)
	}
	if mtime(gitignorePath) != beforeGitignore {
		t.Fatal(".gitignore mtime changed on idempotent EnsureCursorHooks")
	}
}

func TestEnsureCursorHooksLeavesGitStatusClean(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	installInspectableAgentRoot(t)
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
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("raw/\nINGEST_QUEUE.md\n.gdgwiki/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}

	if _, _, err := EnsureCursorHooks(root); err != nil {
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

func TestInspectCursorUserHooksWarnsOnAfterFileEdit(t *testing.T) {
	home, _ := installInspectableAgentRoot(t)
	path := filepath.Join(home, ".cursor", "hooks.json")
	raw := []byte(`{"version":1,"hooks":{"preToolUse":[{"command":"node /tmp/acl-gate.ts","failClosed":true}],"afterFileEdit":[{"command":"true"}]}}`)
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	warnings := InspectCursorUserHooks()
	joined := strings.Join(warnings, "\n")
	if !strings.Contains(joined, "afterFileEdit") {
		t.Fatalf("warnings = %s", joined)
	}
}

func TestInspectCursorUserHooksWarnsOnMatcher(t *testing.T) {
	home, agentRoot := installInspectableAgentRoot(t)
	gate := filepath.Join(agentRoot, "lib", aclGateFileName)
	wk := filepath.Join(agentRoot, "bin", wkLauncherName)
	raw, err := json.Marshal(map[string]any{
		"version": 1,
		"hooks": map[string]any{
			"preToolUse": []map[string]any{{
				"command":    "node " + gate + " " + wk,
				"failClosed": true,
				"matcher":    "Read",
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(home, ".cursor", "hooks.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	warnings := InspectCursorUserHooks()
	joined := strings.Join(warnings, "\n")
	if !strings.Contains(joined, "matcher") {
		t.Fatalf("warnings = %s", joined)
	}
}

func TestCursorAbsolutePathRuleRejectsRelativeGlobShape(t *testing.T) {
	got := CursorAbsolutePathRule("Read", "/srv/gdg-agent/wiki", "pages/*")
	if got != "Read(/srv/gdg-agent/wiki/pages/*)" {
		t.Fatalf("got %s", got)
	}
	if strings.Contains(got, "Read(pages/*)") {
		t.Fatal("relative Cursor globs silently fail open")
	}
}

func TestAgentsLocalSetupShFailsOffUbuntu(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Linux may be Ubuntu; this guard is for macOS development hosts")
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	script := filepath.Join(wd, "..", "..", "..", "scripts", "setup-gdg-agent.sh")
	cmd := exec.Command("bash", script)
	out, runErr := cmd.CombinedOutput()
	if runErr == nil {
		t.Fatalf("setup.sh must fail off Ubuntu:\n%s", out)
	}
	if !bytes.Contains(out, []byte("Ubuntu")) {
		t.Fatalf("expected Ubuntu-only message, got:\n%s", out)
	}
}
