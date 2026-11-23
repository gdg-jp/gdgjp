package wiki

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloneControlFilesStayOutOfCommits(t *testing.T) {
	root := t.TempDir()
	if err := WriteCloneGitignore(root); err != nil {
		t.Fatal(err)
	}
	git(t, root, "init", "-q", "-b", "main")
	if err := WriteCloneExcludes(root); err != nil {
		t.Fatal(err)
	}
	files := []string{
		"pages/index.md",
		"AGENTS.md",
		"AGENTS.original.md",
		"INGEST_QUEUE.md",
		"raw/source-1/conversation.md",
		".gdgwiki/config.json",
		".gdgwiki/state.json",
		".cursor/rules/wiki.mdc",
		".codex/config.toml",
		".githooks/pre-push",
		".agents/skills/wiki/SKILL.md",
		".claude/settings.json",
	}
	for _, rel := range files {
		path := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(rel), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	excludesFile := filepath.Join(t.TempDir(), "no-global-excludes")
	git(t, root, "-c", "core.excludesFile="+excludesFile, "add", "-A")
	got := strings.Fields(git(t, root, "ls-files"))
	if strings.Join(got, " ") != "AGENTS.md pages/index.md" {
		t.Fatalf("staged files = %v, want only AGENTS.md and pages/**", got)
	}
}
