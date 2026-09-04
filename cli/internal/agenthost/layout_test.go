package agenthost

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
}

func defaultSpec(t *testing.T) string {
	t.Helper()
	return filepath.Join(repoRoot(t), "agent-host", "agent-host.json")
}

func emitTo(t *testing.T, prefix string, extra func(*EmitOptions)) {
	t.Helper()
	opts := EmitOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}
	if extra != nil {
		extra(&opts)
	}
	if err := EmitLayout(opts); err != nil {
		t.Fatal(err)
	}
}

func TestEmitLayoutIdempotentAndConvergesBin(t *testing.T) {
	prefix := t.TempDir()
	emitTo(t, prefix, nil)

	stale := filepath.Join(prefix, "opt/gdg-agent/bin/google-workspace-mcp")
	if err := os.WriteFile(stale, []byte("#!/bin/sh\necho stale\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	emitTo(t, prefix, nil)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("undeclared bin wrapper must be removed on re-emit")
	}

	acl, err := os.ReadFile(filepath.Join(prefix, "opt/gdg-agent/lib/acl.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(acl, wiki.AgentLibFiles()["acl.ts"]) {
		t.Fatal("acl.ts must come from the embedded bundle")
	}
	if !bytes.Contains(acl, []byte("@ts-nocheck")) {
		t.Fatal("embedded acl.ts looks empty or unbundled")
	}

	info, err := os.Stat(filepath.Join(prefix, "home/gdgagent-run-0/.cursor"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		t.Fatal(".cursor must not be a symlink")
	}
	if info.Mode()&os.ModeSticky == 0 || info.Mode().Perm() != 0o775 {
		t.Fatalf(".cursor mode = %o", info.Mode())
	}

	mcpRaw, err := os.ReadFile(filepath.Join(prefix, "home/gdgagent-run-2/.cursor/mcp.json"))
	if err != nil {
		t.Fatal(err)
	}
	var mcp map[string]any
	if err := json.Unmarshal(mcpRaw, &mcp); err != nil {
		t.Fatal(err)
	}
	servers := mcp["mcpServers"].(map[string]any)
	if len(servers) != 1 {
		t.Fatalf("mcp servers = %v", servers)
	}
	if _, ok := servers["gdg-index"]; !ok {
		t.Fatal("expected gdg-index")
	}
	env := servers["gdg-index"].(map[string]any)["env"].(map[string]any)
	if env["AGENTS_INDEX_SOCKET"] != "/run/gdg-agent/2/index.sock" {
		t.Fatalf("socket = %v", env["AGENTS_INDEX_SOCKET"])
	}

	wikiInfo, err := os.Stat(filepath.Join(prefix, "srv/gdg-agent/wiki"))
	if err != nil {
		t.Fatal(err)
	}
	if wikiInfo.Mode()&os.ModeSetgid == 0 || wikiInfo.Mode().Perm() != 0o770 {
		t.Fatalf("wiki mode = %o", wikiInfo.Mode())
	}
}

func TestIndexProxyMatchesAgentsIndexSource(t *testing.T) {
	want, err := os.ReadFile(filepath.Join(repoRoot(t), "agents-index/src/proxy.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, indexProxyScript) {
		t.Fatal("cli/internal/agenthost/assets/index-proxy.ts must match agents-index/src/proxy.ts; run pnpm sync:agent-host-assets")
	}
}

func TestEmitLayoutSudoersValidateThenRename(t *testing.T) {
	prefix := t.TempDir()
	sudoersDir := filepath.Join(prefix, "etc/sudoers.d")
	if err := os.MkdirAll(sudoersDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sudoers := filepath.Join(sudoersDir, "gdg-agent")
	original := "# ORIGINAL LIVE SUDOERS CONTENT\n"
	if err := os.WriteFile(sudoers, []byte(original), 0o440); err != nil {
		t.Fatal(err)
	}

	fakeBin := t.TempDir()
	fakeVisudo := filepath.Join(fakeBin, "visudo")
	if err := os.WriteFile(fakeVisudo, []byte("#!/bin/sh\necho 'simulated syntax error' >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))

	err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4})
	if err == nil {
		t.Fatal("expected visudo failure")
	}
	got, readErr := os.ReadFile(sudoers)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(got) != original {
		t.Fatalf("live sudoers changed: %s", got)
	}
}

func TestEmitLayoutRejectsMissingSpec(t *testing.T) {
	err := EmitLayout(EmitOptions{SpecPath: filepath.Join(t.TempDir(), "missing.json"), Prefix: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "spec file not found") {
		t.Fatalf("got %v", err)
	}
}

func TestEmitLayoutRejectsMalformedSpec(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{ invalid json"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := EmitLayout(EmitOptions{SpecPath: path, Prefix: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "Failed to parse spec") {
		t.Fatalf("got %v", err)
	}
}

func TestEmitLayoutRejectsIncompleteSpec(t *testing.T) {
	path := filepath.Join(t.TempDir(), "incomplete.json")
	if err := os.WriteFile(path, []byte(`{"slotCount":4}`), 0o644); err != nil {
		t.Fatal(err)
	}
	err := EmitLayout(EmitOptions{SpecPath: path, Prefix: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "spec.paths must be an object") {
		t.Fatalf("got %v", err)
	}
}

func TestEmitLayoutSlotCountReduction(t *testing.T) {
	prefix := t.TempDir()
	emitTo(t, prefix, func(opts *EmitOptions) { opts.SlotCount = 4 })
	if _, err := os.Stat(filepath.Join(prefix, "opt/gdg-agent/bin/spawn-slot-3")); err != nil {
		t.Fatal(err)
	}
	emitTo(t, prefix, func(opts *EmitOptions) { opts.SlotCount = 3 })
	if _, err := os.Stat(filepath.Join(prefix, "opt/gdg-agent/bin/spawn-slot-3")); !os.IsNotExist(err) {
		t.Fatal("spawn-slot-3 should be gone")
	}
	if _, err := os.Stat(filepath.Join(prefix, "run/gdg-agent/3")); !os.IsNotExist(err) {
		t.Fatal("run slot 3 should be gone")
	}
	if _, err := os.Stat(filepath.Join(prefix, "home/gdgagent-run-3/.cursor")); !os.IsNotExist(err) {
		t.Fatal(".cursor for slot 3 should be gone")
	}
}

func TestApplyOwnershipNoopWithPrefix(t *testing.T) {
	prefix := t.TempDir()
	emitTo(t, prefix, func(opts *EmitOptions) { opts.ApplyOwnership = true })
}

func TestEmitLayoutUsesEmbeddedSpec(t *testing.T) {
	prefix := t.TempDir()
	if err := EmitLayout(EmitOptions{Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(prefix, "opt/gdg-agent/bin/wk")); err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedACLIsBundled(t *testing.T) {
	body := wiki.AgentLibFiles()["acl.ts"]
	if len(body) < 100 {
		t.Fatal("acl.ts embed is missing; run pnpm build:acl before go test")
	}
}
