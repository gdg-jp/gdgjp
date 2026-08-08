package wiki

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestMaterializeSnapshotCreatesGitCommit(t *testing.T) {
	root, commit, err := MaterializeSnapshot(context.Background(), Snapshot{Pages: []Page{{
		ID: "page-1", Slug: "guide", Visibility: "restricted", GeneralRole: "viewer",
		JA: Locale{Title: "ガイド", TranslationStatus: "human", Content: "本文"},
		EN: Locale{Title: "Guide", TranslationStatus: "human", Content: "Body"},
	}}}, "", NewClient(), "", "ja")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	if len(commit) != 40 {
		t.Fatalf("commit = %q", commit)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "guide", "page.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "guide", "ja.md")); !os.IsNotExist(err) {
		t.Fatalf("legacy ja.md should be absent: %v", err)
	}
}
