package wiki

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed hooks/acl-gate.mjs
var aclGateScript []byte

const (
	cursorHooksDirName = ".cursor"
	cursorHooksJSON    = "hooks.json"
	gdgHooksDirName    = "hooks"
	aclGateFileName    = "acl-gate.mjs"
)

// cursorHooksConfig is the project-level Cursor hooks.json for ingest ACL gating.
var cursorHooksConfig = map[string]any{
	"version": 1,
	"hooks": map[string]any{
		"beforeReadFile": []map[string]any{
			{"command": "node .gdgwiki/hooks/acl-gate.mjs read", "timeout": 10},
		},
		"afterFileEdit": []map[string]any{
			{"command": "node .gdgwiki/hooks/acl-gate.mjs write", "timeout": 10},
		},
		"beforeShellExecution": []map[string]any{
			{"command": "node .gdgwiki/hooks/acl-gate.mjs shell", "timeout": 300},
		},
	},
}

func cursorHooksJSONBytes() ([]byte, error) {
	raw, err := json.MarshalIndent(cursorHooksConfig, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(raw, '\n'), nil
}

func fileMatches(path string, want []byte) bool {
	existing, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return bytes.Equal(existing, want)
}

// EnsureCursorHooks writes Cursor project hooks and refreshes clone gitignore /
// excludes so .cursor/ never appears in git status (required for --commit).
// Idempotent: skips writes when content already matches.
func EnsureCursorHooks(root string) (updated bool, err error) {
	if err = WriteCloneGitignore(root); err != nil {
		return false, fmt.Errorf("refresh clone .gitignore: %w", err)
	}
	if err = WriteCloneExcludes(root); err != nil {
		return false, fmt.Errorf("refresh clone excludes: %w", err)
	}

	hooksJSON, err := cursorHooksJSONBytes()
	if err != nil {
		return false, err
	}
	cursorDir := filepath.Join(root, cursorHooksDirName)
	if err = os.MkdirAll(cursorDir, 0o755); err != nil {
		return false, err
	}
	hooksPath := filepath.Join(cursorDir, cursorHooksJSON)
	if !fileMatches(hooksPath, hooksJSON) {
		if err = os.WriteFile(hooksPath, hooksJSON, 0o644); err != nil {
			return false, err
		}
		updated = true
	}

	scriptDir := filepath.Join(ConfigDir(root), gdgHooksDirName)
	if err = os.MkdirAll(scriptDir, 0o755); err != nil {
		return false, err
	}
	scriptPath := filepath.Join(scriptDir, aclGateFileName)
	if !fileMatches(scriptPath, aclGateScript) {
		if err = os.WriteFile(scriptPath, aclGateScript, 0o755); err != nil {
			return false, err
		}
		updated = true
	}
	return updated, nil
}
