package wiki

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSyncEncodesOmittedListFieldsAsEmptyArrays(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(w, `{"ok":true,"pages":[]}`)
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL, HTTPClient: server.Client()}
	_, err := client.Sync(context.Background(), "token", SyncRequest{Operations: []SyncOperation{{
		Kind: "upsert",
		Page: &Page{
			Slug:        "example",
			ParentID:    nil,
			Visibility:  "restricted",
			GeneralRole: "viewer",
			JA:          Locale{Title: "例", TranslationStatus: "human"},
			EN:          Locale{Title: "Example", TranslationStatus: "human"},
		},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	operation := body["operations"].([]any)[0].(map[string]any)
	meta := operation["page"].(map[string]any)["meta"].(map[string]any)
	if _, ok := operation["expectedRevision"]; ok {
		t.Error("new page unexpectedly included expectedRevision")
	}
	if _, ok := operation["page"].(map[string]any)["id"]; ok {
		t.Error("new page unexpectedly included id")
	}
	for _, field := range []string{"tags", "access", "sources", "attachments"} {
		values, ok := meta[field].([]any)
		if !ok || len(values) != 0 {
			t.Errorf("meta.%s = %#v, want empty array", field, meta[field])
		}
	}
}

func TestSyncEncodesAgentInstructionsUpdate(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(w, `{"ok":true,"pages":[]}`)
	}))
	defer server.Close()
	client := &Client{BaseURL: server.URL, HTTPClient: server.Client()}
	_, err := client.Sync(context.Background(), "token", SyncRequest{AgentsMD: &AgentInstructionsUpdate{
		Content: "# Updated\n", ExpectedContentHash: strings.Repeat("a", 64),
	}})
	if err != nil {
		t.Fatal(err)
	}
	agents, ok := body["agentsMd"].(map[string]any)
	if !ok || agents["content"] != "# Updated\n" || agents["expectedContentHash"] != strings.Repeat("a", 64) {
		t.Fatalf("agentsMd = %#v", body["agentsMd"])
	}
}

func TestSourcesManifestDecodesChapterID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/wiki/sources" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"version":1,"documents":[{"documentId":"doc-1","sourceId":"src-1","kind":"source-document","title":"Memo","path":"raw/src-1/conversation.md","contentHash":"hash","visibility":"chapter-member","chapterId":"chapter-1"}]}`)
	}))
	defer server.Close()

	client := &Client{BaseURL: server.URL, HTTPClient: server.Client()}
	manifest, err := client.SourcesManifest(context.Background(), "token", "ja")
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Documents) != 1 || manifest.Documents[0].ChapterID == nil || *manifest.Documents[0].ChapterID != "chapter-1" || !manifest.Documents[0].ChapterIDPresent {
		t.Fatalf("manifest = %#v", manifest)
	}
}

func TestSourcesManifestPreservesChapterIDPresence(t *testing.T) {
	var manifest SourcesManifest
	if err := json.Unmarshal([]byte(`{"version":1,"documents":[{"documentId":"omitted"},{"documentId":"null","chapterId":null},{"documentId":"value","chapterId":"tokyo"}]}`), &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Documents[0].ChapterIDPresent || manifest.Documents[0].ChapterID != nil {
		t.Fatalf("omitted chapterId = %#v", manifest.Documents[0])
	}
	if !manifest.Documents[1].ChapterIDPresent || manifest.Documents[1].ChapterID != nil {
		t.Fatalf("null chapterId = %#v", manifest.Documents[1])
	}
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	var persisted struct {
		Documents []map[string]any `json:"documents"`
	}
	if err := json.Unmarshal(encoded, &persisted); err != nil {
		t.Fatal(err)
	}
	if _, ok := persisted.Documents[0]["chapterId"]; ok {
		t.Fatalf("omitted chapterId was persisted: %s", encoded)
	}
	value, ok := persisted.Documents[1]["chapterId"]
	if !ok || value != nil {
		t.Fatalf("explicit null chapterId was not persisted: %s", encoded)
	}
}
