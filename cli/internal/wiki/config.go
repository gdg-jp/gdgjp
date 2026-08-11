package wiki

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	ConfigDirName  = ".gdgwiki"
	ConfigFileName = "config.json"
	StateFileName  = "state.json"
)

// Config is deliberately local-only: .gdgwiki is ignored so a clone's locale
// never becomes a Git change and is available to the remote helper.
type Config struct {
	Lang string `json:"lang"`
}

// CloneConfig is an alias used by the command layer.
type CloneConfig = Config

func ConfigDir(root string) string {
	return filepath.Join(root, ConfigDirName)
}

func ConfigPath(root string) string {
	return filepath.Join(ConfigDir(root), ConfigFileName)
}

func configPath(root string) string { return ConfigPath(root) }

func LoadConfig(root string) (Config, error) {
	raw, err := os.ReadFile(ConfigPath(root))
	if err != nil {
		return Config{}, err
	}
	var config Config
	if err = json.Unmarshal(raw, &config); err != nil {
		return Config{}, fmt.Errorf("read Wiki clone config: %w", err)
	}
	if config.Lang == "" {
		config.Lang = "ja"
	}
	if config.Lang != "ja" && config.Lang != "en" {
		return Config{}, fmt.Errorf("invalid Wiki clone language %q", config.Lang)
	}
	return config, nil
}

func ReadConfig(root string) (Config, error) { return LoadConfig(root) }

func WriteConfig(root string, config Config) error {
	if config.Lang == "" {
		config.Lang = "ja"
	}
	if config.Lang != "ja" && config.Lang != "en" {
		return fmt.Errorf("invalid Wiki clone language %q", config.Lang)
	}
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigPath(root), append(raw, '\n'), 0o644)
}

// WorkTreeRoot derives the work tree from Git's .git directory.
func WorkTreeRoot(gitDir string) (string, error) {
	if gitDir == "" {
		return "", fmt.Errorf("empty Git directory")
	}
	abs, err := filepath.Abs(gitDir)
	if err != nil {
		return "", err
	}
	if filepath.Base(abs) == ".git" {
		return filepath.Dir(abs), nil
	}
	return filepath.Dir(filepath.Clean(abs)), nil
}

func CloneGitignore() string {
	// Keep local agent/runtime dirs out of git status. EnsureCursorHooks rewrites
	// this file idempotently — omitting a line here makes --commit fail on clones
	// that already have those directories (skills, hooks, Cursor project config).
	return strings.Join([]string{
		"raw/",
		"AGENTS.original.md",
		"INGEST_QUEUE.md",
		".gdgwiki/",
		".cursor/",
		".codex",
		".githooks/",
		".agents/",
		".claude/",
		"",
	}, "\n")
}

func WriteCloneGitignore(root string) error {
	path := filepath.Join(root, ".gitignore")
	want := []byte(CloneGitignore())
	if existing, err := os.ReadFile(path); err == nil && string(existing) == string(want) {
		return nil
	}
	return os.WriteFile(path, want, 0o644)
}

// WriteCloneExcludes keeps generated local control files out of git status.
// They must never become a commit because the remote helper intentionally
// accepts pushes containing only pages/**.
func WriteCloneExcludes(root string) error {
	path := filepath.Join(root, ".git", "info", "exclude")
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// Test doubles and callers before git init have no local exclude file.
		return nil
	}
	if err != nil {
		return err
	}
	if strings.Contains("\n"+string(raw)+"\n", "\n.gitignore\n") {
		return nil
	}
	return os.WriteFile(path, append(raw, []byte("\n.gitignore\n")...), 0o644)
}
