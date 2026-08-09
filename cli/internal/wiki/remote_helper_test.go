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
	content := git(t, repository, "show", commit+":pages/welcome/page.md")
	if !strings.Contains(content, "ようこそ") {
		t.Fatalf("synthetic commit did not contain snapshot page: %s", content)
	}
	if _, err := os.Stat(filepath.Join(gitDir, "gdg-wiki", "snapshots", commit+".json")); err != nil {
		t.Fatalf("snapshot metadata: %v", err)
	}
}

func TestRemoteHelperSnapshotImportDoesNotModifyFetchHead(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	const existing = "existing merge candidate\n"
	if err := os.WriteFile(filepath.Join(gitDir, "FETCH_HEAD"), []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}

	helper := &RemoteHelper{
		GitDir: gitDir,
		Remote: "origin",
		Stdin:  strings.NewReader("list\nfetch ignored refs/heads/main\n\n"),
		Stdout: new(bytes.Buffer),
		Snapshot: func(context.Context, string) (Snapshot, error) {
			return Snapshot{Pages: []Page{{
				ID: "page-1", Slug: "welcome", Revision: 1,
				JA: Locale{Title: "ようこそ"}, EN: Locale{Title: "Welcome"},
			}}}, nil
		},
	}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(gitDir, "FETCH_HEAD"))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != existing {
		t.Fatalf("FETCH_HEAD = %q, want preserved value %q", raw, existing)
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
	path := filepath.Join(repository, "pages", "welcome", "page.md")
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

func TestRemoteHelperPushBatchesChangedPagesAndNewHierarchy(t *testing.T) {
	repository := t.TempDir()
	git(t, repository, "init", "-q")
	gitDir := filepath.Join(repository, ".git")
	t.Setenv("GIT_DIR", gitDir)
	current := Snapshot{Pages: []Page{
		{ID: "index-id", Slug: "index", Revision: 2, Visibility: "restricted", GeneralRole: "viewer", JA: Locale{Title: "Index", TranslationStatus: "human", Content: "before index"}},
		{ID: "log-id", Slug: "log", Revision: 3, Visibility: "restricted", GeneralRole: "viewer", JA: Locale{Title: "Log", TranslationStatus: "human", Content: "before log"}},
	}}
	var listed bytes.Buffer
	helper := &RemoteHelper{
		GitDir: gitDir, Remote: "origin", Stdin: strings.NewReader("list\n"), Stdout: &listed,
		Snapshot: func(context.Context, string) (Snapshot, error) { return current, nil },
	}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	base := strings.Fields(listed.String())[0]
	git(t, repository, "update-ref", "refs/remotes/origin/main", base)
	git(t, repository, "checkout", "-q", "-b", "main", base)
	for _, slug := range []string{"index", "log"} {
		path := filepath.Join(repository, "pages", slug, "page.md")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, bytes.Replace(raw, []byte("before "+slug), []byte("after "+slug), 1), 0644); err != nil {
			t.Fatal(err)
		}
	}
	newParent := filepath.Join(repository, "pages", "guides", "page.md")
	if err := os.MkdirAll(filepath.Dir(newParent), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newParent, []byte("---\ngdg_wiki: 1\nslug: guides\nlanguage: ja\ntitle: Guides\ntranslation_status: human\nparent_slug: null\nvisibility: restricted\ngeneral_role: viewer\n---\nguides"), 0644); err != nil {
		t.Fatal(err)
	}
	newPage := filepath.Join(repository, "pages", "guides", "child", "page.md")
	if err := os.MkdirAll(filepath.Dir(newPage), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newPage, []byte("---\ngdg_wiki: 1\nslug: child\nlanguage: ja\ntitle: Child\ntranslation_status: human\nparent_slug: guides\nvisibility: restricted\ngeneral_role: viewer\n---\nchild"), 0644); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "add", "pages")
	git(t, repository, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "batch")
	tip := git(t, repository, "rev-parse", "HEAD")

	var request SyncRequest
	syncCalls := 0
	helper.Stdin = strings.NewReader("push " + tip + ":refs/heads/main\n\n")
	helper.Stdout = new(bytes.Buffer)
	helper.Sync = func(_ context.Context, _ string, value SyncRequest) (SyncResult, error) {
		syncCalls++
		request = value
		pages := make([]SyncResultPage, len(value.Operations))
		for i, operation := range value.Operations {
			pages[i] = SyncResultPage{ID: operation.Page.ID, Slug: operation.Page.Slug, Revision: 5, AttachmentIDs: map[string]string{}}
		}
		return SyncResult{OK: true, Pages: pages}, nil
	}
	if err := helper.Run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if syncCalls != 1 || len(request.Operations) != 4 {
		t.Fatalf("sync calls = %d, operations = %d; want one call with four operations", syncCalls, len(request.Operations))
	}
	if request.Operations[0].Page.Slug != "guides" || request.Operations[1].Page.Slug != "index" || request.Operations[2].Page.Slug != "log" || request.Operations[3].Page.Slug != "child" {
		t.Fatalf("operation order = %s, %s, %s, %s", request.Operations[0].Page.Slug, request.Operations[1].Page.Slug, request.Operations[2].Page.Slug, request.Operations[3].Page.Slug)
	}
	parentID := request.Operations[0].Page.ID
	child := request.Operations[3].Page
	if child.ID == "" || child.ParentID == nil || *child.ParentID != parentID {
		t.Fatalf("new child identity = %#v", child)
	}
	if parentID != newPageID(tip, "guides") || child.ID != newPageID(tip, filepath.Join("guides", "child")) {
		t.Fatalf("new page IDs are not stable for commit %s", tip)
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
	// Hooks and remote-helper calls export repository-local Git variables. Commands
	// explicitly run in the test repository must not inherit any of them.
	command.Env = os.Environ()
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
		command.Env = withoutEnvironment(command.Env, name)
	}
	raw, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %s", strings.Join(args, " "), raw)
	}
	return strings.TrimSpace(string(raw))
}
