package command

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/spf13/pflag"
)

func TestEmitLayoutPrefixUsesEmbeddedSpec(t *testing.T) {
	prefix := t.TempDir()
	root := NewRoot()
	root.SetArgs([]string{"agent-host", "emit-layout", "--prefix", prefix})
	root.SilenceUsage = true
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	wk := filepath.Join(prefix, "opt/gdg-agent/bin/wk")
	if _, err := os.Stat(wk); err != nil {
		t.Fatalf("embedded-spec emit-layout did not write wk: %v", err)
	}
}

// 3. --force 相当のフラグが存在しない（安全装置に迂回路が無いこと。フラグ一覧を固定するテストで担保する）
func TestApplyCommandHasNoForceOrBypassFlags(t *testing.T) {
	cmd := newAgentHostApplyCommand()

	forbiddenFlags := []string{
		"force",
		"skip-capability-check",
		"skip-contract",
		"unsafe",
		"ignore-contract",
		"bypass",
	}

	for _, forbidden := range forbiddenFlags {
		if flag := cmd.Flags().Lookup(forbidden); flag != nil {
			t.Errorf("CRITICAL: apply command must not have bypass flag --%s", forbidden)
		}
	}

	// Verify exact allowed flags on apply command
	expectedFlags := map[string]bool{
		"spec":       true,
		"overlay":    true,
		"prefix":     true,
		"slot-count": true,
		"dry-run":    true,
		"diff":       true,
		"only":       true,
		"prune":      true,
	}

	flagCount := 0
	cmd.Flags().VisitAll(func(f *pflag.Flag) {
		flagCount++
		if !expectedFlags[f.Name] {
			t.Errorf("unexpected flag --%s on apply command", f.Name)
		}
	})
	if flagCount != len(expectedFlags) {
		t.Errorf("expected %d flags on apply command, got %d", len(expectedFlags), flagCount)
	}
}

func TestValidateSpecCommand(t *testing.T) {
	tempDir := t.TempDir()

	prodSpecJSON := `{
		"environment": "production",
		"slotCount": 4,
		"backend": {
			"name": "cursor",
			"model": "composer-2.5",
			"isolation": {
				"slotLauncher": true,
				"osSandbox": "workspace",
				"toolGate": "preToolUse-failClosed"
			}
		},
		"discord": { "showThinking": false, "streaming": false, "completionNotify": "off" },
		"pins": {
			"cursorAgent": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"xangi": { "repo": "r", "ref": "0000000000000000000000000000000000000000" },
			"gws": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"gdgCli": { "version": "v1", "assetTemplate": "t", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"node": { "major": 22, "minMinor": 18 }
		},
		"paths": { "agentRoot": "/opt/gdg-agent", "workspace": "/srv/gdg-agent/wiki", "runRoot": "/run/gdg-agent" }
	}`
	prodSpecPath := filepath.Join(tempDir, "prod-spec.json")
	if err := os.WriteFile(prodSpecPath, []byte(prodSpecJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	devSpecJSON := `{
		"environment": "development",
		"slotCount": 4,
		"backend": {
			"name": "antigravity",
			"model": "gemini-2.5",
			"isolation": {
				"slotLauncher": false,
				"osSandbox": "none",
				"toolGate": "none"
			}
		},
		"discord": { "showThinking": false, "streaming": false, "completionNotify": "off" },
		"pins": {
			"cursorAgent": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"xangi": { "repo": "r", "ref": "0000000000000000000000000000000000000000" },
			"gws": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"gdgCli": { "version": "v1", "assetTemplate": "t", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"node": { "major": 22, "minMinor": 18 }
		},
		"paths": { "agentRoot": "/opt/gdg-agent", "workspace": "/srv/gdg-agent/wiki", "runRoot": "/run/gdg-agent" }
	}`
	devSpecPath := filepath.Join(tempDir, "dev-spec.json")
	if err := os.WriteFile(devSpecPath, []byte(devSpecJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	// 1. Production spec passes validate-spec
	root := NewRoot()
	root.SetArgs([]string{"agent-host", "validate-spec", "--spec", prodSpecPath})
	root.SilenceUsage = true
	if err := root.Execute(); err != nil {
		t.Fatalf("expected validate-spec to pass for prod spec: %v", err)
	}

	// 2. Production spec passes validate-spec --for-release
	root = NewRoot()
	root.SetArgs([]string{"agent-host", "validate-spec", "--for-release", "--spec", prodSpecPath})
	root.SilenceUsage = true
	if err := root.Execute(); err != nil {
		t.Fatalf("expected validate-spec --for-release to pass for prod spec: %v", err)
	}

	// 3. Development spec passes validate-spec (allowed locally)
	root = NewRoot()
	root.SetArgs([]string{"agent-host", "validate-spec", "--spec", devSpecPath})
	root.SilenceUsage = true
	if err := root.Execute(); err != nil {
		t.Fatalf("expected validate-spec to pass for dev spec in local context: %v", err)
	}

	// 4. Development spec fails validate-spec --for-release
	root = NewRoot()
	root.SetArgs([]string{"agent-host", "validate-spec", "--for-release", "--spec", devSpecPath})
	root.SilenceUsage = true
	if err := root.Execute(); err == nil {
		t.Fatalf("expected validate-spec --for-release to fail for dev spec")
	}

	// 5. Ensure validate-spec has no force or bypass flags
	cmd := newAgentHostValidateSpecCommand()
	for _, forbidden := range []string{"force", "skip-check", "bypass"} {
		if flag := cmd.Flags().Lookup(forbidden); flag != nil {
			t.Errorf("validate-spec command must not have bypass flag --%s", forbidden)
		}
	}
}
