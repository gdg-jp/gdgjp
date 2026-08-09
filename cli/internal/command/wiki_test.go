package command

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

type gitCall struct {
	directory string
	args      []string
}

func testWikiService(run gitRunner) *wikiService {
	return &wikiService{
		runGit:        run,
		executable:    os.Executable,
		installHelper: func(string) (string, error) { return "git-remote-gdg-wiki", nil },
		newClient:     wiki.NewClient,
		runAgent:      func(context.Context, string, string) error { return nil },
	}
}

func executeWiki(t *testing.T, service *wikiService, args ...string) (string, error) {
	t.Helper()
	command := newWikiCommandWithService(service)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func clearGitLocalEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_COMMON_DIR",
		"GIT_CONFIG",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_PARAMETERS",
		"GIT_DIR",
		"GIT_GRAFT_FILE",
		"GIT_IMPLICIT_WORK_TREE",
		"GIT_INDEX_FILE",
		"GIT_NO_REPLACE_OBJECTS",
		"GIT_OBJECT_DIRECTORY",
		"GIT_PREFIX",
		"GIT_REPLACE_REF_BASE",
		"GIT_SHALLOW_FILE",
		"GIT_WORK_TREE",
	} {
		if value, exists := os.LookupEnv(name); exists {
			t.Setenv(name, value)
		} else {
			t.Setenv(name, "")
		}
		if err := os.Unsetenv(name); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWikiCloneUsesGDGWikiRemote(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "wiki")
	var calls []gitCall
	var installed string
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		return "", nil
	})
	service.installHelper = func(executable string) (string, error) {
		installed = executable
		return "git-remote-gdg-wiki", nil
	}

	output, err := executeWiki(t, service, "clone", "--lang", "ja", target)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output, "lang=ja") {
		t.Fatalf("output = %q", output)
	}
	if !strings.Contains(output, "re-clone") {
		t.Fatalf("expected re-clone warning, got %q", output)
	}
	if installed == "" {
		t.Fatal("clone did not ensure the Git helper")
	}
	cfg, err := wiki.ReadConfig(target)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Lang != "ja" {
		t.Fatalf("lang = %q", cfg.Lang)
	}
	raw, err := os.ReadFile(filepath.Join(target, ".gitignore"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "raw/") {
		t.Fatalf("gitignore = %q", raw)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"init -b main",
		"remote add origin " + defaultWikiRemote,
		"fetch origin main",
		"reset --hard refs/remotes/origin/main",
		"config branch.main.remote origin",
		"config branch.main.merge refs/heads/main",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Git calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestWikiCloneBootstrapsUnbornBranchWithRemoteHelper(t *testing.T) {
	clearGitLocalEnvironment(t)
	ctx := context.Background()
	seed := t.TempDir()
	if _, err := runGit(ctx, seed, "init", "-b", "main"); err != nil {
		t.Fatal(err)
	}
	page := filepath.Join(seed, "pages", "welcome", "page.md")
	if err := os.MkdirAll(filepath.Dir(page), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(page, []byte("# Welcome\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(ctx, seed, "add", "pages"); err != nil {
		t.Fatal(err)
	}
	if _, err := runGit(ctx, seed, "-c", "user.name=GDG Wiki", "-c", "user.email=wiki@gdgs.jp", "commit", "-m", "Wiki snapshot"); err != nil {
		t.Fatal(err)
	}
	commit, err := runGit(ctx, seed, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	commit = strings.TrimSpace(commit)

	bin := t.TempDir()
	helper := filepath.Join(bin, "git-remote-gdg-wiki")
	const helperScript = `#!/bin/sh
pending_fetch=0
while IFS= read -r line; do
	case "$line" in
		capabilities)
			printf 'fetch\n\n'
			;;
		list*)
			git fetch --no-tags --quiet "$TEST_WIKI_SEED" "$TEST_WIKI_COMMIT" || exit 1
			printf '%s refs/heads/main\n\n' "$TEST_WIKI_COMMIT"
			;;
		fetch\ *)
			pending_fetch=1
			;;
		option\ *)
			printf 'ok\n'
			;;
		"")
			if [ "$pending_fetch" -eq 1 ]; then
				printf '\n'
				pending_fetch=0
			fi
			;;
		*)
			exit 1
			;;
	esac
done
`
	if err := os.WriteFile(helper, []byte(helperScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TEST_WIKI_SEED", seed)
	t.Setenv("TEST_WIKI_COMMIT", commit)

	target := filepath.Join(t.TempDir(), "wiki")
	service := testWikiService(runGit)
	if _, err := executeWiki(t, service, "clone", "--lang", "en", "--remote", "gdg-wiki::test", target); err != nil {
		t.Fatal(err)
	}

	head, err := runGit(ctx, target, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	tracking, err := runGit(ctx, target, "rev-parse", "refs/remotes/origin/main")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(head) != commit || strings.TrimSpace(tracking) != commit {
		t.Fatalf("HEAD = %q, origin/main = %q, want %q", strings.TrimSpace(head), strings.TrimSpace(tracking), commit)
	}
	upstream, err := runGit(ctx, target, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(upstream) != "origin/main" {
		t.Fatalf("upstream = %q, want origin/main", strings.TrimSpace(upstream))
	}
	raw, err := os.ReadFile(filepath.Join(target, "pages", "welcome", "page.md"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "# Welcome\n" {
		t.Fatalf("page content = %q", raw)
	}
	cfg, err := wiki.ReadConfig(target)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Lang != "en" {
		t.Fatalf("lang = %q, want en", cfg.Lang)
	}
}

func TestWikiInitConfiguresRemoteWithoutFetchingOrCommitting(t *testing.T) {
	root := t.TempDir()
	var calls []gitCall
	service := testWikiService(func(_ context.Context, directory string, args ...string) (string, error) {
		calls = append(calls, gitCall{directory: directory, args: args})
		switch strings.Join(args, " ") {
		case "rev-parse --is-inside-work-tree", "remote get-url origin":
			return "", errors.New("missing")
		default:
			return "", nil
		}
	})

	output, err := executeWiki(t, service, "init", root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output, "git pull") {
		t.Fatalf("unexpected output: %q", output)
	}
	got := make([]string, 0, len(calls))
	for _, call := range calls {
		got = append(got, strings.Join(call.args, " "))
	}
	want := []string{
		"rev-parse --is-inside-work-tree",
		"init -b main",
		"remote get-url origin",
		"remote add origin " + defaultWikiRemote,
		"config branch.main.remote origin",
		"config branch.main.merge refs/heads/main",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("Git calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestFindWikiRootRequiresCloneConfig(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested", "deeper")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := wiki.WriteConfig(root, wiki.CloneConfig{Lang: "en"}); err != nil {
		t.Fatal(err)
	}

	got, err := findWikiRoot(nested)
	if err != nil {
		t.Fatal(err)
	}
	if got != root {
		t.Fatalf("root = %q, want %q", got, root)
	}
}

func TestFindWikiRootRejectsUnrelatedGitRepository(t *testing.T) {
	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}

	if _, err := findWikiRoot(nested); err == nil || !strings.Contains(err.Error(), ".gdgwiki/config.json") {
		t.Fatalf("findWikiRoot error = %v", err)
	}
}

func TestFindWikiRootRejectsMalformedCloneConfig(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(wiki.ConfigPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(wiki.ConfigPath(root), []byte(`{"lang":"fr"}`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := findWikiRoot(root); err == nil || !strings.Contains(err.Error(), "invalid Wiki clone language") {
		t.Fatalf("findWikiRoot error = %v", err)
	}
}
