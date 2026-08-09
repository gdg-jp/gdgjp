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
