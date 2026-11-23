package wiki

import (
	"encoding/json"
	"os"
	"sort"
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

func TestWriteACLSourcesWritesOnlyVisibilityAndChapter(t *testing.T) {
	root := t.TempDir()
	mediaType := "text/markdown"
	capturedAt := int64(1)
	manifest := SourcesManifest{Version: 1, Documents: []SourcesManifestEntry{{
		DocumentID:       "document-1",
		SourceID:         stringPtr("source-1"),
		Kind:             "source-document",
		Title:            "Secret title",
		Path:             "raw/source-1/conversation.md",
		ContentHash:      "content-hash",
		MediaType:        &mediaType,
		CapturedAt:       &capturedAt,
		Visibility:       stringPtr("chapter-member"),
		ChapterID:        stringPtr("tokyo"),
		ChapterIDPresent: true,
	}}}
	if err := WriteACLSources(root, manifest); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(ACLSourcesPath(root))
	if err != nil {
		t.Fatal(err)
	}
	var sources map[string]map[string]json.RawMessage
	if err := json.Unmarshal(raw, &sources); err != nil {
		t.Fatal(err)
	}
	if len(sources) != 1 || sources["source-1"] == nil {
		t.Fatalf("ACL sources = %s", raw)
	}
	keys := make([]string, 0, len(sources["source-1"]))
	for key := range sources["source-1"] {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "chapterId,visibility" {
		t.Fatalf("ACL source fields = %v, want only chapterId and visibility", keys)
	}
}

func TestWriteACLSourcesKeepsConversationSourcesAbsentFromTheManifest(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	existing := `{"conversation-1":{"visibility":"member","chapterId":null},"source-1":{"visibility":"public","chapterId":null}}`
	if err := os.WriteFile(ACLSourcesPath(root), []byte(existing), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := SourcesManifest{Documents: []SourcesManifestEntry{{
		SourceID:         stringPtr("source-1"),
		Visibility:       stringPtr("chapter-member"),
		ChapterID:        stringPtr("tokyo"),
		ChapterIDPresent: true,
	}}}
	if err := WriteACLSources(root, manifest); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(ACLSourcesPath(root))
	if err != nil {
		t.Fatal(err)
	}
	var sources map[string]ACLSource
	if err := json.Unmarshal(raw, &sources); err != nil {
		t.Fatal(err)
	}
	conversation, ok := sources["conversation-1"]
	if !ok || conversation.Visibility != "member" || conversation.ChapterID != nil {
		t.Fatalf("conversation source not preserved: %s", raw)
	}
	refreshed := sources["source-1"]
	if refreshed.Visibility != "chapter-member" || refreshed.ChapterID == nil || *refreshed.ChapterID != "tokyo" {
		t.Fatalf("manifest source not refreshed: %s", raw)
	}
}

func stringPtr(value string) *string { return &value }
