package wiki

import (
	"os"
	"strings"
	"testing"
)

func TestWriteACLSourcesIncludesOnlyResolvedSourceMetadata(t *testing.T) {
	root := t.TempDir()
	chapter := "tokyo"
	visibility := "chapter-member"
	sourceID := "source-1"
	manifest := SourcesManifest{Documents: []SourcesManifestEntry{
		{SourceID: &sourceID, Visibility: &visibility, ChapterID: &chapter, ChapterIDPresent: true},
		{SourceID: stringPtr("legacy"), Visibility: stringPtr("member")},
		{SourceID: stringPtr("missing-visibility"), ChapterID: &chapter, ChapterIDPresent: true},
	}}
	if err := WriteACLSources(root, manifest); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(ACLSourcesPath(root))
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if !strings.Contains(got, `"source-1"`) || !strings.Contains(got, `"chapterId": "tokyo"`) {
		t.Fatalf("ACL source metadata missing resolved source: %s", got)
	}
	if strings.Contains(got, "legacy") || strings.Contains(got, "missing-visibility") {
		t.Fatalf("ACL source metadata included unresolved source: %s", got)
	}
}

func stringPtr(value string) *string { return &value }
