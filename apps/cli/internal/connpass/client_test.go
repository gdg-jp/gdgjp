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
	if len(groups) != 1 || groups[0].GroupId != "gdg-tokyo" || !groups[0].Enabled {
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
		var payload UpsertGroupRequest
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.ChapterId == nil || *payload.ChapterId != "tokyo" ||
			payload.NumericGroupId == nil || *payload.NumericGroupId != 42 {
			t.Fatalf("payload = %#v", payload)
		}
		_ = json.NewEncoder(w).Encode(Group{
			GroupId:        "gdg-tokyo",
			NumericGroupId: payload.NumericGroupId,
			ChapterId:      payload.ChapterId,
			Enabled:        true,
		})
	}))
	t.Cleanup(server.Close)

	numericID := 42
	chapterID := "tokyo"
	group, err := NewClientAt(server.URL).UpsertGroup(context.Background(), "token", "gdg-tokyo", UpsertGroupRequest{
		ChapterId:      &chapterID,
		NumericGroupId: &numericID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if group.GroupId != "gdg-tokyo" || group.ChapterId == nil || *group.ChapterId != "tokyo" {
		t.Fatalf("group = %#v", group)
	}
}

func TestGetEvent(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/groups/gdg-tokyo/events/123" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"groupId": "gdg-tokyo",
			"event": map[string]any{
				"id":                  "123",
				"url":                 "https://connpass.com/event/123/",
				"editUrl":             "https://connpass.com/editmanagedevent/123/",
				"status":              "draft",
				"title":               "Meetup",
				"startAt":             "2026-01-01T19:00:00+09:00",
				"endAt":               "2026-01-01T21:00:00+09:00",
				"registrationEnabled": true,
				"allowConflictJoin":   false,
				"allowReceipt":        false,
				"subEventCount":       0,
				"hasSurvey":           false,
				"hasConference":       false,
			},
		})
	}))
	t.Cleanup(server.Close)

	out, err := NewClientAt(server.URL).GetEvent(context.Background(), "token", "gdg-tokyo", "123")
	if err != nil {
		t.Fatal(err)
	}
	if out.GroupID != "gdg-tokyo" || out.Event.Title != "Meetup" {
		t.Fatalf("out = %#v", out)
	}
}

func TestUpdateEventSendsPartialBody(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPatch || r.URL.Path != "/api/groups/gdg-tokyo/events/123" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if len(payload) != 1 || payload["title"] != "Updated" {
			t.Fatalf("payload = %#v", payload)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "job-1", "type": "update_event", "status": "queued",
			"groupId": "gdg-tokyo", "createdBy": "user", "createdAt": "t", "updatedAt": "t",
		})
	}))
	t.Cleanup(server.Close)

	job, err := NewClientAt(server.URL).UpdateEvent(
		context.Background(), "token", "gdg-tokyo", "123", map[string]any{"title": "Updated"},
	)
	if err != nil {
		t.Fatal(err)
	}
	if job.Id != "job-1" {
		t.Fatalf("job = %#v", job)
	}
}

func TestCancelSubEvent(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/groups/gdg-tokyo/events/123/sub-events/456" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "job-2", "type": "delete_sub_event", "status": "queued",
			"groupId": "gdg-tokyo", "createdBy": "user", "createdAt": "t", "updatedAt": "t",
		})
	}))
	t.Cleanup(server.Close)

	job, err := NewClientAt(server.URL).CancelSubEvent(context.Background(), "token", "gdg-tokyo", "123", "456")
	if err != nil {
		t.Fatal(err)
	}
	if job.Id != "job-2" {
		t.Fatalf("job = %#v", job)
	}
}

func TestUpsertSurvey(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/groups/gdg-tokyo/events/123/survey" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		questions, ok := payload["questions"].([]any)
		if !ok || len(questions) != 1 {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "job-3", "type": "upsert_survey", "status": "queued",
			"groupId": "gdg-tokyo", "createdBy": "user", "createdAt": "t", "updatedAt": "t",
		})
	}))
	t.Cleanup(server.Close)

	job, err := NewClientAt(server.URL).UpsertSurvey(context.Background(), "token", "gdg-tokyo", "123", map[string]any{
		"questions": []map[string]any{
			{"title": "Q1", "answerType": "free_text", "required": false},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if job.Id != "job-3" {
		t.Fatalf("job = %#v", job)
	}
}

func TestRelogin(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/admin/session/relogin" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "job-4", "type": "relogin", "status": "queued",
			"groupId": "", "createdBy": "user", "createdAt": "t", "updatedAt": "t",
		})
	}))
	t.Cleanup(server.Close)

	job, err := NewClientAt(server.URL).Relogin(context.Background(), "token")
	if err != nil {
		t.Fatal(err)
	}
	if job.Id != "job-4" {
		t.Fatalf("job = %#v", job)
	}
}
