package connpass

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListGroups(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/admin/groups" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Fatalf("authorization = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"groups": []map[string]any{
				{"groupId": "gdg-tokyo", "numericGroupId": 1, "chapterId": "tokyo", "enabled": true},
			},
		})
	}))
	t.Cleanup(server.Close)

	groups, err := NewClientAt(server.URL).ListGroups(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].GroupID != "gdg-tokyo" || !groups[0].Enabled {
		t.Fatalf("groups = %#v", groups)
	}
}

func TestUpsertGroup(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/admin/groups/gdg-tokyo" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload UpsertGroupInput
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.ChapterID != "tokyo" || payload.NumericGroupID == nil || *payload.NumericGroupID != 42 {
			t.Fatalf("payload = %#v", payload)
		}
		_ = json.NewEncoder(w).Encode(Group{
			GroupID:        "gdg-tokyo",
			NumericGroupID: payload.NumericGroupID,
			ChapterID:      &payload.ChapterID,
			Enabled:        true,
		})
	}))
	t.Cleanup(server.Close)

	numericID := 42
	group, err := NewClientAt(server.URL).UpsertGroup(context.Background(), "token", "gdg-tokyo", UpsertGroupInput{
		ChapterID:      "tokyo",
		NumericGroupID: &numericID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if group.GroupID != "gdg-tokyo" || group.ChapterID == nil || *group.ChapterID != "tokyo" {
		t.Fatalf("group = %#v", group)
	}
}
