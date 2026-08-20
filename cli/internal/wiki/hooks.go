package wiki

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed hooks/acl-gate.ts
var aclGateScript []byte

//go:embed hooks/wk.ts
var wkScript []byte

//go:embed hooks/acl-core.ts
var aclCoreScript []byte

//go:embed hooks/shell-allowlist.ts
var shellAllowlistScript []byte

//go:embed hooks/commit-tripwire.ts
var commitTripwireScript []byte

//go:embed hooks/acl-insert-core.ts
var aclInsertCoreScript []byte

//go:embed hooks/package.json
var hooksPackageJSON []byte

const (
	cursorHooksDirName = ".cursor"
	cursorHooksJSON    = "hooks.json"
	aclGateFileName    = "acl-gate.ts"
	wkFileName         = "wk.ts"
	aclCoreFileName    = "acl-core.ts"
	aclBundleFileName  = "acl.ts"
	packageJSONName    = "package.json"
	wkLauncherName     = "wk"
)

func fileMatches(path string, want []byte) bool {
	existing, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return bytes.Equal(existing, want)
}

func userCursorHooksPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, ".cursor", cursorHooksJSON)
}

// CursorAbsolutePathRule formats a Cursor permission glob with a resolved
// absolute path. Relative globs such as Read(pages/*) never match.
func CursorAbsolutePathRule(tool, cloneRoot, glob string) string {
	abs := filepath.ToSlash(filepath.Join(cloneRoot, glob))
	return tool + "(" + abs + ")"
}

func parseNodeHookCommand(command string) (gatePath string, wkPath string) {
	fields := strings.Fields(command)
	for i, field := range fields {
		if strings.HasSuffix(field, aclGateFileName) {
			gatePath = field
			if i+1 < len(fields) {
				wkPath = fields[i+1]
			}
			return gatePath, wkPath
		}
	}
	return "", ""
}

func inspectUserHooksJSON(raw []byte) (gatePath string, warnings []string) {
	if bytes.Contains(raw, []byte("afterFileEdit")) {
		warnings = append(warnings, "user hooks.json still lists afterFileEdit; remove it")
	}
	if bytes.Contains(raw, []byte("beforeReadFile")) || bytes.Contains(raw, []byte("beforeShellExecution")) {
		warnings = append(warnings, "user hooks.json still lists a non-preToolUse Cursor hook")
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", append(warnings, "user hooks.json is not valid JSON")
	}
	if version, _ := parsed["version"].(float64); version != 1 {
		warnings = append(warnings, "user hooks.json version is not 1")
	}
	hooks, _ := parsed["hooks"].(map[string]any)
	if hooks == nil {
		return "", append(warnings, "user hooks.json has no hooks object")
	}
	pre, _ := hooks["preToolUse"].([]any)
	if len(pre) == 0 {
		return "", append(warnings, "user hooks.json has no preToolUse hook")
	}
	foundFailClosed := false
	for _, item := range pre {
		entry, _ := item.(map[string]any)
		if entry == nil {
			continue
		}
		command, _ := entry["command"].(string)
		failClosed, _ := entry["failClosed"].(bool)
		if strings.Contains(command, aclGateFileName) {
			gatePath, _ = parseNodeHookCommand(command)
			if failClosed {
				foundFailClosed = true
			}
			if _, hasMatcher := entry["matcher"]; hasMatcher {
				warnings = append(warnings, "user hooks.json preToolUse must not set matcher")
			}
		}
	}
	if gatePath == "" {
		warnings = append(warnings, "user hooks.json preToolUse does not run acl-gate.ts")
	}
	if !foundFailClosed {
		warnings = append(warnings, "user hooks.json preToolUse is missing failClosed: true")
	}
	return gatePath, warnings
}

func inspectInstalledScripts(gatePath string) []string {
	var warnings []string
	if gatePath == "" {
		return warnings
	}
	libDir := filepath.Dir(gatePath)
	agentRoot := filepath.Dir(libDir)
	checks := []struct {
		path string
		want []byte
		name string
	}{
		{gatePath, aclGateScript, aclGateFileName},
		{filepath.Join(libDir, wkFileName), wkScript, wkFileName},
		{filepath.Join(libDir, aclCoreFileName), aclCoreScript, aclCoreFileName},
		{filepath.Join(libDir, "shell-allowlist.ts"), shellAllowlistScript, "shell-allowlist.ts"},
		{filepath.Join(libDir, "commit-tripwire.ts"), commitTripwireScript, "commit-tripwire.ts"},
		{filepath.Join(libDir, "acl-insert-core.ts"), aclInsertCoreScript, "acl-insert-core.ts"},
		{filepath.Join(agentRoot, packageJSONName), hooksPackageJSON, packageJSONName},
	}
	for _, check := range checks {
		if _, err := os.Stat(check.path); err != nil {
			warnings = append(warnings, fmt.Sprintf("missing %s at %s", check.name, check.path))
			continue
		}
		if check.want != nil && !fileMatches(check.path, check.want) {
			warnings = append(warnings, fmt.Sprintf("stale %s at %s", check.name, check.path))
		}
	}
	if _, err := os.Stat(filepath.Join(libDir, aclBundleFileName)); err != nil {
		warnings = append(warnings, fmt.Sprintf("missing %s at %s (run pnpm build:acl before setup.sh)", aclBundleFileName, filepath.Join(libDir, aclBundleFileName)))
	}
	wkBin := filepath.Join(agentRoot, "bin", wkLauncherName)
	if _, err := os.Stat(wkBin); err != nil {
		warnings = append(warnings, fmt.Sprintf("missing wk launcher at %s", wkBin))
	}
	return warnings
}

// InspectCursorUserHooks checks ~/.cursor/hooks.json and the scripts it points at.
// It never writes clone-local hooks. Missing user hooks are warnings, not errors.
func InspectCursorUserHooks() []string {
	path := userCursorHooksPath()
	if path == "" {
		return []string{"cannot resolve home directory for ~/.cursor/hooks.json"}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return []string{"~/.cursor/hooks.json is missing; run scripts/setup-gdg-agent.sh on Ubuntu"}
	}
	gatePath, warnings := inspectUserHooksJSON(raw)
	warnings = append(warnings, inspectInstalledScripts(gatePath)...)
	return warnings
}

// EnsureCursorHooks refreshes clone gitignore / excludes and inspects user hooks.
// It does not write clone-local .cursor/hooks.json (agents can write that tree).
func EnsureCursorHooks(root string) (updated bool, warnings []string, err error) {
	gitignorePath := filepath.Join(root, ".gitignore")
	want := []byte(CloneGitignore())
	existing, readErr := os.ReadFile(gitignorePath)
	needGitignore := readErr != nil || !bytes.Equal(existing, want)
	if err = WriteCloneGitignore(root); err != nil {
		return false, nil, fmt.Errorf("refresh clone .gitignore: %w", err)
	}
	if err = WriteCloneExcludes(root); err != nil {
		return false, nil, fmt.Errorf("refresh clone excludes: %w", err)
	}
	return needGitignore, InspectCursorUserHooks(), nil
}
