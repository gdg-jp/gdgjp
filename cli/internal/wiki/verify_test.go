package wiki

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveReadSourceIDsUsesLocksNotQueueHead(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	srcHead := "org-src"
	srcLocked := "locked-src"
	state := State{
		Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
			{
				DocumentID:  "doc-1",
				SourceID:    &srcHead,
				Kind:        "source-document",
				Title:       "Head",
				Path:        "raw/org-src/doc.md",
				ContentHash: "abc",
			},
			{
				DocumentID:  "doc-2",
				SourceID:    &srcLocked,
				Kind:        "source-document",
				Title:       "Locked",
				Path:        "raw/locked-src/doc.md",
				ContentHash: "def",
			},
		}},
	}
	ids := ResolveReadSourceIDs(root, state, IngestTrace{})
	if len(ids) != 0 {
		t.Fatalf("ids without locks = %#v, want none (queue head must not be implied)", ids)
	}
	if _, err := LockDocument(root, "doc-2", "owner-a", "def"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GDG_WIKI_LOCK_OWNER", "owner-a")
	ids = ResolveReadSourceIDs(root, state, IngestTrace{})
	if len(ids) != 1 || ids[0] != "locked-src" {
		t.Fatalf("ids with lock = %#v", ids)
	}
}

func TestResolveReadSourceIDsAddsTraceReads(t *testing.T) {
	root := t.TempDir()
	src1 := "src-1"
	src2 := "src-2"
	state := State{
		Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{
			{DocumentID: "d1", SourceID: &src1, Kind: "source-document", Title: "A", Path: "raw/src-1/a.md", ContentHash: "1"},
			{DocumentID: "d2", SourceID: &src2, Kind: "source-document", Title: "B", Path: "raw/src-2/b.md", ContentHash: "2"},
		}},
	}
	ids := ResolveReadSourceIDs(root, state, IngestTrace{
		Reads: []string{"raw/src-2/b.md", "raw/src-2/extra.txt"},
	})
	if len(ids) != 1 || ids[0] != "src-2" {
		t.Fatalf("ids = %#v, want only traced source (not the unlocked queue head)", ids)
	}
}

func TestCollectChangedPageRels(t *testing.T) {
	runGit := func(_ context.Context, _ string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if strings.HasPrefix(joined, "diff --name-only") {
			return "pages/venues/umeda/page.md\npages/index/page.md\n", nil
		}
		if strings.HasPrefix(joined, "status --porcelain") {
			return "?? pages/new-page/page.md\n M pages/venues/umeda/assets/x.png\n", nil
		}
		t.Fatalf("unexpected git: %s", joined)
		return "", nil
	}
	rels, err := CollectChangedPageRels(context.Background(), "/tmp", runGit)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(rels, ",")
	for _, want := range []string{"venues/umeda", "index", "new-page"} {
		found := false
		for _, rel := range rels {
			if rel == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing %s in %s", want, got)
		}
	}
}

func TestPageRelsFromTraceWrites(t *testing.T) {
	rels := PageRelsFromTraceWrites([]string{
		"pages/venues/umeda/page.md",
		"pages/venues/umeda/assets/x.png",
		"pages/index/page.md",
		"raw/should-ignore.md",
	})
	got := strings.Join(rels, ",")
	if !strings.Contains(got, "venues/umeda") || !strings.Contains(got, "index") {
		t.Fatalf("rels = %#v", rels)
	}
	if len(rels) != 2 {
		t.Fatalf("expected 2 unique page dirs, got %#v", rels)
	}
}

func TestCollectCommittedPageRelsUsesBaseRevRange(t *testing.T) {
	runGit := func(_ context.Context, _ string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if joined == "diff --name-only base123..HEAD -- pages/" {
			return "pages/venues/umeda/page.md\npages/index/page.md\n", nil
		}
		t.Fatalf("unexpected git: %s", joined)
		return "", nil
	}
	rels, err := CollectCommittedPageRels(context.Background(), "/tmp", runGit, "base123")
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(rels, ",")
	if !strings.Contains(got, "venues/umeda") || !strings.Contains(got, "index") {
		t.Fatalf("rels = %#v", rels)
	}
}

func TestCollectCommittedPageRelsSkipsWithoutBaseRev(t *testing.T) {
	runGit := func(context.Context, string, ...string) (string, error) {
		t.Fatal("must not walk tip history without baseRev")
		return "", nil
	}
	rels, err := CollectCommittedPageRels(context.Background(), "/tmp", runGit, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(rels) != 0 {
		t.Fatalf("rels = %#v, want empty", rels)
	}
}

func writeVerifyTestPage(t *testing.T, root, rel, id, slug, visibility, body string) {
	t.Helper()
	dir := filepath.Join(root, "pages", filepath.FromSlash(rel))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	markdown := "---\ngdg_wiki: 1\nid: " + id + "\nslug: " + slug +
		"\nlanguage: ja\ntitle: " + slug + "\ntranslation_status: human\nvisibility: " +
		visibility + "\ngeneral_role: viewer\n---\n" + body + "\n"
	if err := os.WriteFile(filepath.Join(dir, "page.md"), []byte(markdown), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyACLUsesTraceWritesWhenGitClean(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	src := "org-src"
	if err := WriteState(root, State{Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID: "doc-1", SourceID: &src, Kind: "source-document",
		Title: "Secret", Path: "raw/org-src/doc.md", ContentHash: "h1",
	}}}}); err != nil {
		t.Fatal(err)
	}
	// Public sibling must NOT be submitted — audience-cover on organizer-only page.
	writeVerifyTestPage(t, root, "index", "index", "index", "public", "public body")
	writeVerifyTestPage(t, root, "umeda", "umeda", "umeda", "organizer", "secret body")
	if err := WriteTrace(root, IngestTrace{
		RunID: "run-1", QueueHeadID: "doc-1",
		Reads:  []string{"raw/org-src/doc.md"},
		Writes: []string{"pages/umeda/page.md"},
	}); err != nil {
		t.Fatal(err)
	}

	var gotReq ValidateACLRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/wiki/validate-acl" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Errorf("decode: %v", err)
		}
		_ = json.NewEncoder(w).Encode(ValidateACLResult{OK: true})
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	// Dirty/diff empty and tip history empty → Cursor Writes recover the set.
	emptyGit := func(_ context.Context, _ string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if strings.HasPrefix(joined, "diff-tree") {
			return "", nil
		}
		return "", nil
	}
	result, err := VerifyACL(context.Background(), root, client, "tok", emptyGit)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("result = %#v", result)
	}
	if len(gotReq.Pages) != 1 || gotReq.Pages[0].Slug != "umeda" {
		t.Fatalf("submitted pages = %#v (must be write-set only, not whole wiki)", gotReq.Pages)
	}
	if gotReq.Pages[0].Visibility != "organizer" {
		t.Fatalf("visibility = %q", gotReq.Pages[0].Visibility)
	}
	if len(gotReq.ReadSourceIDs) != 1 || gotReq.ReadSourceIDs[0] != "org-src" {
		t.Fatalf("readSourceIds = %#v", gotReq.ReadSourceIDs)
	}
}

func TestVerifyACLUsesTipCommitWhenGitCleanAndNoWrites(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	src := "org-src"
	if err := WriteState(root, State{Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID: "doc-1", SourceID: &src, Kind: "source-document",
		Title: "Secret", Path: "raw/org-src/doc.md", ContentHash: "h1",
	}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := LockDocument(root, "doc-1", "owner-a", "h1"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GDG_WIKI_LOCK_OWNER", "owner-a")
	writeVerifyTestPage(t, root, "index", "index", "index", "public", "public body")
	writeVerifyTestPage(t, root, "umeda", "umeda", "umeda", "organizer", "secret body")
	// No Cursor Writes — claude/codex / shell tee path. BaseRev pins the
	// pre-push tip so only this ingest's commits are recovered.
	if err := ResetIngestTrace(root, "doc-1", "pre-push"); err != nil {
		t.Fatal(err)
	}

	var gotReq ValidateACLRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/wiki/validate-acl" {
			http.NotFound(w, r)
			return
		}
		if err := json.NewDecoder(r.Body).Decode(&gotReq); err != nil {
			t.Errorf("decode: %v", err)
		}
		_ = json.NewEncoder(w).Encode(ValidateACLResult{OK: true})
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	runGit := func(_ context.Context, _ string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if strings.HasPrefix(joined, "diff --name-only refs/remotes/origin/main") ||
			strings.HasPrefix(joined, "status --porcelain") {
			return "", nil
		}
		if joined == "diff --name-only pre-push..HEAD -- pages/" {
			return "pages/umeda/page.md\n", nil
		}
		t.Fatalf("unexpected git: %s", joined)
		return "", nil
	}
	result, err := VerifyACL(context.Background(), root, client, "tok", runGit)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("result = %#v", result)
	}
	if len(gotReq.Pages) != 1 || gotReq.Pages[0].Slug != "umeda" {
		t.Fatalf("submitted pages = %#v (tip-commit set only, not whole wiki)", gotReq.Pages)
	}
	if len(gotReq.ReadSourceIDs) != 1 || gotReq.ReadSourceIDs[0] != "org-src" {
		t.Fatalf("readSourceIds = %#v", gotReq.ReadSourceIDs)
	}
}

func TestVerifyACLIgnoresUnrelatedTipWithoutNewCommits(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	src := "org-src"
	if err := WriteState(root, State{Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID: "doc-1", SourceID: &src, Kind: "source-document",
		Title: "Secret", Path: "raw/org-src/doc.md", ContentHash: "h1",
	}}}}); err != nil {
		t.Fatal(err)
	}
	writeVerifyTestPage(t, root, "intermission", "intermission", "intermission", "restricted", "old")
	// Ingest just started: BaseRev == HEAD, no writes yet. Prior tip pages must
	// not be submitted against the new confidential queue head.
	if err := ResetIngestTrace(root, "doc-1", "same-as-head"); err != nil {
		t.Fatal(err)
	}

	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		_ = json.NewEncoder(w).Encode(ValidateACLResult{OK: true})
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	runGit := func(_ context.Context, _ string, args ...string) (string, error) {
		joined := strings.Join(args, " ")
		if strings.HasPrefix(joined, "diff --name-only refs/remotes/origin/main") ||
			strings.HasPrefix(joined, "status --porcelain") {
			return "", nil
		}
		if joined == "diff --name-only same-as-head..HEAD -- pages/" {
			return "", nil
		}
		t.Fatalf("unexpected git: %s", joined)
		return "", nil
	}
	result, err := VerifyACL(context.Background(), root, client, "tok", runGit)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("result = %#v", result)
	}
	if called {
		t.Fatal("must not validate unrelated tip pages against a new queue head")
	}
}

func TestVerifyACLOkWhenGitCleanAndNoWrites(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	src := "org-src"
	if err := WriteState(root, State{Manifest: &SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID: "doc-1", SourceID: &src, Kind: "source-document",
		Title: "Secret", Path: "raw/org-src/doc.md", ContentHash: "h1",
	}}}}); err != nil {
		t.Fatal(err)
	}
	writeVerifyTestPage(t, root, "index", "index", "index", "public", "body")
	if err := ResetIngestTrace(root, "doc-1", ""); err != nil {
		t.Fatal(err)
	}

	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		_ = json.NewEncoder(w).Encode(ValidateACLResult{OK: true})
	}))
	defer server.Close()
	client := NewClientAt(server.URL)
	client.HTTPClient = server.Client()

	// Dirty/diff empty, tip history empty, no Writes → short-circuit OK.
	emptyGit := func(context.Context, string, ...string) (string, error) { return "", nil }
	result, err := VerifyACL(context.Background(), root, client, "tok", emptyGit)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("result = %#v", result)
	}
	if called {
		t.Fatal("must not call validate-acl with empty submitted pages (would false-fail run-level)")
	}
}
