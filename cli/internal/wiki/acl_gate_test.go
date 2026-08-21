package wiki

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func gateScript(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(wd, "hooks", "acl-gate.ts")
}

func writeClone(t *testing.T, root string) {
	t.Helper()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"pages/x", "raw/src", "memories"} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(rel)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte("# agents\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte("---\nvisibility: public\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "raw", "src", "doc.md"), []byte("secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "memories", "note.md"), []byte("---\nvisibility: member\n---\nmem\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func runGate(t *testing.T, dir string, payload map[string]any, extraWk string) (stdout, stderr string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	args := []string{gateScript(t)}
	if extraWk != "" {
		args = append(args, extraWk)
	}
	cmd := exec.Command("node", args...)
	cmd.Dir = dir
	cmd.Stdin = bytes.NewReader(raw)
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	if runErr := cmd.Run(); runErr != nil {
		t.Fatalf("gate exited %v\nstdout=%s\nstderr=%s", runErr, outBuf.String(), errBuf.String())
	}
	return outBuf.String(), errBuf.String()
}

func assertDeny(t *testing.T, stdout, want string) {
	t.Helper()
	if !strings.Contains(stdout, `"permission":"deny"`) {
		t.Fatalf("expected deny JSON, got %s", stdout)
	}
	if want != "" && !strings.Contains(stdout, want) {
		t.Fatalf("expected %q in %s", want, stdout)
	}
}

func assertAllow(t *testing.T, stdout string) {
	t.Helper()
	var payload struct {
		Permission string `json:"permission"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &payload); err != nil {
		t.Fatalf("allow must write permission JSON, got %s", stdout)
	}
	if payload.Permission != "allow" {
		t.Fatalf("expected permission allow, got %s", stdout)
	}
}

func TestACLGateReadGatedPaths(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	for _, rel := range []string{"pages/x/page.md", "raw/src/doc.md", "memories/note.md"} {
		stdout, _ := runGate(t, root, map[string]any{
			"hook_event_name": "preToolUse",
			"tool_name":       "Read",
			"cwd":             root,
			"tool_input":      map[string]any{"file_path": filepath.Join(root, filepath.FromSlash(rel))},
		}, "")
		assertDeny(t, stdout, "wk read "+rel)
	}
	stdout, _ := runGate(t, root, map[string]any{
		"hook_event_name": "preToolUse",
		"tool_name":       "Read",
		"cwd":             root,
		"tool_input":      map[string]any{"file_path": filepath.Join(root, "AGENTS.md")},
	}, "")
	assertAllow(t, stdout)
}

func TestACLGateGrepOfCloneRootIsDenied(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	stdout, _ := runGate(t, root, map[string]any{
		"tool_name":  "Grep",
		"cwd":        root,
		"tool_input": map[string]any{"pattern": "secret", "path": root},
	}, "")
	assertDeny(t, stdout, "wk grep")
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name":  "Grep",
		"cwd":        root,
		"tool_input": map[string]any{"pattern": "secret", "path": filepath.Dir(root)},
	}, "")
	assertDeny(t, stdout, "wk grep")
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name":  "List",
		"cwd":        root,
		"tool_input": map[string]any{"path": "."},
	}, "")
	assertDeny(t, stdout, "wk ls")
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name": "Glob",
		"cwd":       root,
		"tool_input": map[string]any{
			"glob_pattern":     "*",
			"target_directory": filepath.Join(root, "pages"),
		},
	}, "")
	assertDeny(t, stdout, "wk ls")
}

func TestACLGateWriteAlwaysDenied(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	paths := []string{
		filepath.Join(root, ".git", "hooks", "pre-commit"),
		filepath.Join(root, ".cursor", "sandbox.json"),
		filepath.Join(root, ".gdgwiki", "acl-sources.json"),
		filepath.Join(root, "AGENTS.md"),
		"/tmp/outside.txt",
	}
	for _, path := range paths {
		stdout, _ := runGate(t, root, map[string]any{
			"tool_name":  "Write",
			"cwd":        root,
			"tool_input": map[string]any{"file_path": path},
		}, "")
		assertDeny(t, stdout, "wk write")
	}
	stdout, _ := runGate(t, root, map[string]any{
		"tool_name":  "Delete",
		"cwd":        root,
		"tool_input": map[string]any{"file_path": filepath.Join(root, ".gitattributes")},
	}, "")
	assertDeny(t, stdout, "wk rm")
	stdout, _ = runGate(t, root, map[string]any{"tool_name": "FooBar", "cwd": root}, "")
	assertDeny(t, stdout, "blocked")
}

func TestACLGateMCPAllowlist(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	stdout, _ := runGate(t, root, map[string]any{"tool_name": "MCP:search", "cwd": root}, "")
	assertAllow(t, stdout)
	stdout, _ = runGate(t, root, map[string]any{"tool_name": "MCP:filesystem", "cwd": root}, "")
	assertDeny(t, stdout, "search")
}

func TestACLGateShellAllowlist(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	allow := []string{
		"wk read pages/x/page.md",
		"wk ls pages/",
		"wk ls pages/\n",
		"wk ls \"pages/\"",
		"wk ls 'pages/'",
		"wk grep '締切' pages/",
		"wk read pages/x/page.md && wk grep 'x' pages/",
		"wk write pages/x/page.md <<'EOF'\nhello\nEOF\n",
	}
	for _, command := range allow {
		stdout, _ := runGate(t, root, map[string]any{
			"tool_name":  "Shell",
			"cwd":        root,
			"tool_input": map[string]any{"command": command},
		}, "")
		if strings.Contains(stdout, `"permission":"deny"`) {
			t.Fatalf("allowlisted command denied: %s\n%s", command, stdout)
		}
	}
	deny := []string{
		"cat pages/x/page.md",
		"wk read x | head -20",
		"sed -i s/a/b/ pages/x/page.md",
		"python3 - <<EOF\nprint(1)\nEOF",
		"wk read $(ls raw)",
		"FOO=bar wk read x",
		"./wk read x",
		"wkx read x",
		"wk read a; wk read b",
		"wk ls \"pages/$x\"",
		"wk write p <<EOF\nbody\nEOF\n",
		"wk write p <<'EOF'\nbody\nEOF; rm x\n",
	}
	for _, command := range deny {
		stdout, _ := runGate(t, root, map[string]any{
			"tool_name":  "Shell",
			"cwd":        root,
			"tool_input": map[string]any{"command": command},
		}, "")
		assertDeny(t, stdout, "wk")
	}
}

func TestACLGateAbsoluteWkFromArgv(t *testing.T) {
	root := t.TempDir()
	writeClone(t, root)
	extra := filepath.Join(t.TempDir(), "bin", "wk")
	if err := os.MkdirAll(filepath.Dir(extra), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(extra, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	stdout, _ := runGate(t, root, map[string]any{
		"tool_name":  "Shell",
		"cwd":        root,
		"tool_input": map[string]any{"command": extra + " read pages/x/page.md"},
	}, extra)
	assertAllow(t, stdout)
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name":  "Shell",
		"cwd":        root,
		"tool_input": map[string]any{"command": extra + " read pages/x/page.md"},
	}, "")
	assertDeny(t, stdout, "wk")
}

func TestACLGateCommitTripwireLooksAtIndex(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	root := t.TempDir()
	writeClone(t, root)
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
	tagged := "---\nvisibility: public\n---\n<" + "acl src=\"s\">secret</" + "acl>\n"
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(tagged), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "pages/x/page.md")
	run("commit", "-m", "seed")

	untagged := "---\nvisibility: public\n---\nleaked secret\n"
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(untagged), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "pages/x/page.md")
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(tagged), 0o644); err != nil {
		t.Fatal(err)
	}
	stdout, _ := runGate(t, root, map[string]any{
		"tool_name":  "Shell",
		"cwd":        root,
		"tool_input": map[string]any{"command": "wk git commit -m x"},
	}, "")
	assertDeny(t, stdout, "gate bypass")

	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(tagged+"more\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Restage tagged content so the happy path can pass the tripwire.
	taggedStaged := "---\nvisibility: public\n---\n<" + "acl src=\"s\">secret\nmore</" + "acl>\n"
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(taggedStaged), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "pages/x/page.md")
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name":  "Shell",
		"cwd":        root,
		"tool_input": map[string]any{"command": "wk git commit -m x"},
	}, "")
	if strings.Contains(stdout, "gate bypass") {
		t.Fatalf("tagged index must not trip the bypass message: %s", stdout)
	}

	untaggedWorktree := "---\nvisibility: public\n---\npublic note\n"
	if err := os.WriteFile(filepath.Join(root, "pages", "x", "page.md"), []byte(untaggedWorktree), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "pages/x/page.md")
	stdout, _ = runGate(t, root, map[string]any{
		"tool_name":  "Shell",
		"cwd":        root,
		"tool_input": map[string]any{"command": "wk git commit -m x"},
	}, "")
	if strings.Contains(stdout, "gate bypass") {
		t.Fatalf("worktree matching the index must not trip: %s", stdout)
	}
}

func TestACLGateSourceHasNoACLJudgment(t *testing.T) {
	raw, err := os.ReadFile(gateScript(t))
	if err != nil {
		t.Fatal(err)
	}
	src := string(raw)
	for _, banned := range []string{"canClasses", "canMutatePage", "visibility", "<acl"} {
		if strings.Contains(src, banned) {
			t.Fatalf("acl-gate.ts must not contain %q", banned)
		}
	}
	if strings.Contains(src, "process.platform") || strings.Contains(src, "/opt/gdg-agent") {
		t.Fatal("acl-gate.ts must not embed platform or install-prefix literals")
	}
	if !strings.Contains(src, `PASSTHROUGH_TOOLS`) || !strings.Contains(src, `"MCP:search"`) && !strings.Contains(src, `"search"`) {
		t.Fatal("passthrough tools must be a named allowlist")
	}
}
