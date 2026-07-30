package wiki

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestMaterializeSnapshotCreatesGitCommit(t *testing.T) {
	root, commit, err := MaterializeSnapshot(context.Background(), Snapshot{Pages: []Page{{
		ID: "page-1", Slug: "guide", Status: "published", Visibility: "restricted", GeneralRole: "viewer",
		JA: Locale{Title: "ガイド", TranslationStatus: "human", Content: "本文"},
		EN: Locale{Title: "Guide", TranslationStatus: "human", Content: "Body"},
	}}}, "", NewClient(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	if len(commit) != 40 {
		t.Fatalf("commit = %q", commit)
	}
	if _, err := os.Stat(filepath.Join(root, "pages", "guide", "ja.md")); err != nil {
		t.Fatal(err)
	}
}
