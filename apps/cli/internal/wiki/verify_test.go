package wiki

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func TestVerifyACLRequiresAReadSet(t *testing.T) {
	_, err := VerifyACLWithReadSources(context.Background(), t.TempDir(), &Client{}, "t", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "read sources are required") {
		t.Fatalf("a nil read set must be an error, got %v", err)
	}
}

// A synthesize job that adds events/x/program/examples (all new) failed verify-acl with
// "new parent has not been created", although the push itself creates the whole tree.
func TestBuildValidateACLPagesAcceptsNewPagesUnderNewParents(t *testing.T) {
	root := t.TempDir()
	write := func(rel, slug, parent string) {
		dir := filepath.Join(root, "pages", filepath.FromSlash(rel))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		fm := "---\ngdg_wiki: 1\nslug: " + slug + "\nlanguage: ja\ntitle: " + slug +
			"\ntranslation_status: human\nvisibility: restricted\ngeneral_role: viewer\n"
		if parent != "" {
			fm += "parent_slug: " + parent + "\n"
		}
		if err := os.WriteFile(filepath.Join(dir, "page.md"), []byte(fm+"---\nbody\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("events", "events", "")
	write("events/program", "program", "events")
	write("events/program/examples", "examples", "program")

	pages, err := BuildValidateACLPages(root, []string{"events", "events/program", "events/program/examples"})
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 3 {
		t.Fatalf("pages = %d, want 3", len(pages))
	}
	for _, page := range pages {
		if page.ID != nil {
			t.Fatalf("new page %s was sent with ID %q", page.Slug, *page.ID)
		}
	}
}
