package wiki

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemoteHelperListsAndImportsSyntheticSnapshot(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)

	var output bytes.Buffer
	helper := &RemoteHelper{
		GitDir: gitDir,
		Remote: "gdg-wiki",
		Stdin:  strings.NewReader("capabilities\nlist\nfetch ignored refs/heads/main\n"),
		Stdout: &output,
		Snapshot: func(context.Context, string) (Snapshot, error) {
			return Snapshot{Pages: []Page{{
				ID: "page-1", Slug: "welcome", Revision: 3,
				JA: Locale{Title: "ようこそ"}, EN: Locale{Title: "Welcome"},
			}}}, nil
		},
	}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	refLine := ""
	for _, line := range lines {
		if strings.Contains(line, "refs/heads/main") {
			refLine = line
			break
		}
	}
	if len(lines) == 0 || lines[0] != "fetch" || refLine == "" {
		t.Fatalf("unexpected helper protocol output: %q", output.String())
	}
	commit := strings.Fields(refLine)[0]
	git(t, repository, "cat-file", "-e", commit+"^{commit}")
	content := git(t, repository, "show", commit+":pages/welcome/ja.md")
	if !strings.Contains(content, "ようこそ") {
		t.Fatalf("synthetic commit did not contain snapshot page: %s", content)
	}
	if _, err := os.Stat(filepath.Join(gitDir, "gdg-wiki", "snapshots", commit+".json")); err != nil {
		t.Fatalf("snapshot metadata: %v", err)
	}
}

func TestRemoteHelperReusesUnchangedTrackingSnapshot(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	snapshot := Snapshot{Pages: []Page{{
		ID: "page-1", Slug: "welcome", Revision: 3,
		JA: Locale{Title: "ようこそ"}, EN: Locale{Title: "Welcome"},
	}}}
	run := func() string {
		var output bytes.Buffer
		helper := &RemoteHelper{GitDir: gitDir, Remote: "gdg-wiki", Stdin: strings.NewReader("list\n"), Stdout: &output, Snapshot: func(context.Context, string) (Snapshot, error) { return snapshot, nil }}
		if err := helper.Run(context.Background()); err != nil {
			t.Fatal(err)
		}
		return strings.Fields(output.String())[0]
	}
	first := run()
	git(t, repository, "update-ref", "refs/remotes/gdg-wiki/main", first)
	if second := run(); second != first {
		t.Fatalf("unchanged snapshot produced a new commit: got %s, want %s", second, first)
	}
}

func TestRemoteHelperListsEmptyWiki(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	var output bytes.Buffer
	helper := &RemoteHelper{
		GitDir: gitDir, Remote: "gdg-wiki", Stdin: strings.NewReader("list\n"), Stdout: &output,
		Snapshot: func(context.Context, string) (Snapshot, error) { return Snapshot{}, nil },
	}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(output.String())
	if len(fields) < 2 || fields[1] != "refs/heads/main" {
		t.Fatalf("unexpected list response: %q", output.String())
	}
	git(t, repository, "cat-file", "-e", fields[0]+"^{commit}")
}

func TestRemoteHelperPushesCommittedPageChangeAndCachesCanonicalSnapshot(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	current := Snapshot{Pages: []Page{{
		ID: "page-1", Slug: "welcome", Revision: 3, Visibility: "restricted", GeneralRole: "viewer",
		JA: Locale{Title: "ようこそ", TranslationStatus: "human", Content: "before"},
		EN: Locale{Title: "Welcome", TranslationStatus: "human", Content: "before"},
	}}}
	var listed bytes.Buffer
	helper := &RemoteHelper{GitDir: gitDir, Remote: "origin", Stdin: strings.NewReader("list\n"), Stdout: &listed,
		Snapshot: func(context.Context, string) (Snapshot, error) { return current, nil }}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	base := strings.Fields(listed.String())[0]
	git(t, repository, "update-ref", "refs/remotes/origin/main", base)
	git(t, repository, "checkout", "-q", "-b", "main", base)
	path := filepath.Join(repository, "pages", "welcome", "ja.md")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, bytes.Replace(raw, []byte("before"), []byte("after"), 1), 0644); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "add", "pages")
	git(t, repository, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "update")
	tip := git(t, repository, "rev-parse", "HEAD")
	var request SyncRequest
	helper.Stdin = strings.NewReader("push " + tip + ":refs/heads/main\n\n")
	helper.Stdout = new(bytes.Buffer)
	helper.Sync = func(_ context.Context, _ string, value SyncRequest) (SyncResult, error) {
		request = value
		current.Pages[0].Revision = 4
		current.Pages[0].JA.Content = "after"
		return SyncResult{OK: true, Pages: []SyncResultPage{{ID: "page-1", Slug: "welcome", Revision: 4, AttachmentIDs: map[string]string{}}}}, nil
	}
	if err = helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(request.Operations) != 1 || request.Operations[0].ExpectedRevision != 3 || request.Operations[0].Page.JA.Content != "after" {
		t.Fatalf("sync request = %#v", request)
	}
	if output := helper.Stdout.(*bytes.Buffer).String(); output != "ok refs/heads/main\n\n" {
		t.Fatalf("push protocol = %q", output)
	}
	tracking := git(t, repository, "rev-parse", "refs/remotes/origin/main")
	metadata, err := helper.readMetadata(tracking)
	if err != nil || metadata.Snapshot.Pages[0].Revision != 4 {
		t.Fatalf("canonical metadata = %#v, %v", metadata, err)
	}
}

func TestRemoteHelperPushReportsConflictWithoutChangingWorktree(t *testing.T) {
	// A remote-helper error line is deliberately a protocol-level push failure;
	// the helper only reads commits and leaves the caller's checkout untouched.
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	git(t, repository, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "base")
	base := git(t, repository, "rev-parse", "HEAD")
	git(t, repository, "update-ref", "refs/remotes/origin/main", base)
	helper := &RemoteHelper{GitDir: gitDir, Remote: "origin", Stdin: strings.NewReader("push " + base + ":refs/heads/main\n\n"), Stdout: new(bytes.Buffer), Snapshot: func(context.Context, string) (Snapshot, error) { return Snapshot{}, nil }}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(helper.Stdout.(*bytes.Buffer).String(), "error refs/heads/main missing Wiki metadata") {
		t.Fatalf("output = %q", helper.Stdout.(*bytes.Buffer).String())
	}
}

func git(t *testing.T, directory string, args ...string) string {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	// A remote-helper call runs with GIT_DIR set by Git. Tests set it as well,
	// but commands explicitly run in the test repository must not inherit it.
	command.Env = withoutEnvironment(os.Environ(), "GIT_DIR")
	raw, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %s", strings.Join(args, " "), raw)
	}
	return strings.TrimSpace(string(raw))
}
