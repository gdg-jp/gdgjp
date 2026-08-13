package command

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func executeConnpass(t *testing.T, args ...string) (string, error) {
	t.Helper()
	return executeConnpassWithStdin(t, "", args...)
}

func executeConnpassWithStdin(t *testing.T, stdin string, args ...string) (string, error) {
	t.Helper()
	command := newConnpassCommand(&memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	}})
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	command.SilenceUsage = true
	command.SilenceErrors = true
	if stdin != "" {
		command.SetIn(strings.NewReader(stdin))
	}
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func queuedJob(id, jobType, status string) map[string]any {
	return map[string]any{
		"id":        id,
		"type":      jobType,
		"status":    status,
		"groupId":   "gdg-tokyo",
		"createdBy": "user",
		"createdAt": "t",
		"updatedAt": "t",
	}
}

func TestConnpassGroupsList(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/admin/groups" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"groups": []map[string]any{
				{"groupId": "gdg-tokyo", "chapterId": "tokyo", "enabled": true},
			},
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "groups", "list")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"groupId": "gdg-tokyo"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassGroupsUpsert(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/admin/groups/gdg-tokyo" {
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
		if payload["chapterId"] != "tokyo" || payload["numericGroupId"] != float64(12345) {
			t.Fatalf("payload = %#v", payload)
		}
		if payload["enabled"] != true {
			t.Fatalf("enabled = %#v", payload["enabled"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"groupId":        "gdg-tokyo",
			"numericGroupId": 12345,
			"chapterId":      "tokyo",
			"enabled":        true,
		})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t,
		"groups", "upsert", "gdg-tokyo",
		"--chapter-id", "tokyo",
		"--numeric-group-id", "12345",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"chapterId": "tokyo"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassEventsCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/groups/gdg-tokyo/events" {
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
		if payload["title"] != "Meetup" {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-create", "create_event", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "events", "create", "gdg-tokyo", "--title", "Meetup")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "job-create"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassEventsPublishOptionalBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/groups/gdg-tokyo/events/123/publish" {
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
		if len(payload) != 0 {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-publish", "publish_event", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "events", "publish", "gdg-tokyo", "123")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "job-publish"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassEventsUpdateSendsOnlyChangedFlags(t *testing.T) {
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
		if _, ok := payload["allowReceipt"]; ok {
			t.Fatalf("unexpected allowReceipt in %#v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-update", "update_event", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	_, err := executeConnpass(t, "events", "update", "gdg-tokyo", "123", "--title", "Updated")
	if err != nil {
		t.Fatal(err)
	}
}

func TestConnpassEventsCreateFromFileTitleOverride(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/groups/gdg-tokyo/events" {
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
		if payload["title"] != "FromFlag" || payload["place"] != "Tokyo" {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-create", "create_event", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	path := filepath.Join(t.TempDir(), "event.json")
	if err := os.WriteFile(path, []byte(`{"title":"FromFile","place":"Tokyo"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := executeConnpass(t, "events", "create", "gdg-tokyo", "--from-file", path, "--title", "FromFlag")
	if err != nil {
		t.Fatal(err)
	}
}

func TestConnpassWaitSucceededAndFailed(t *testing.T) {
	t.Run("succeeded", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodPost && r.URL.Path == "/api/groups/gdg-tokyo/events":
				w.WriteHeader(http.StatusAccepted)
				_ = json.NewEncoder(w).Encode(queuedJob("job-wait", "create_event", "queued"))
			case r.Method == http.MethodGet && r.URL.Path == "/api/jobs/job-wait":
				_ = json.NewEncoder(w).Encode(queuedJob("job-wait", "create_event", "succeeded"))
			default:
				t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
			}
		}))
		t.Cleanup(server.Close)
		t.Setenv("GDG_CONNPASS_URL", server.URL)

		out, err := executeConnpass(t, "events", "create", "gdg-tokyo", "--title", "Meetup", "--wait")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(out, `"status": "succeeded"`) {
			t.Fatalf("output = %s", out)
		}
	})

	t.Run("failed", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/api/jobs/job-fail":
				job := queuedJob("job-fail", "create_event", "failed")
				job["error"] = "browser crashed"
				_ = json.NewEncoder(w).Encode(job)
			default:
				t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
			}
		}))
		t.Cleanup(server.Close)
		t.Setenv("GDG_CONNPASS_URL", server.URL)

		_, err := executeConnpass(t, "jobs", "wait", "job-fail")
		if err == nil || !strings.Contains(err.Error(), "browser crashed") {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestConnpassSurveyUpsertRequiresJSON(t *testing.T) {
	_, err := executeConnpass(t, "events", "survey", "upsert", "gdg-tokyo", "123")
	if err == nil || !strings.Contains(err.Error(), "--from-file or --json") {
		t.Fatalf("err = %v", err)
	}
}

func TestConnpassSurveyUpsertJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/api/groups/gdg-tokyo/events/123/survey" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-survey", "upsert_survey", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "events", "survey", "upsert", "gdg-tokyo", "123",
		"--json", `{"questions":[{"title":"Q1","answerType":"free_text","required":false}]}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "job-survey"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassEventsListAndSessionRelogin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/groups/gdg-tokyo/events":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"groupId": "gdg-tokyo", "resultsReturned": 0, "events": []any{},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/admin/session/relogin":
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(queuedJob("job-relogin", "relogin", "queued"))
		default:
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "events", "list", "gdg-tokyo")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"groupId": "gdg-tokyo"`) {
		t.Fatalf("output = %s", out)
	}

	out, err = executeConnpass(t, "session", "relogin")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "job-relogin"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestConnpassSubEventsCancel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/groups/gdg-tokyo/events/123/sub-events/456" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(queuedJob("job-cancel", "delete_sub_event", "queued"))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_CONNPASS_URL", server.URL)

	out, err := executeConnpass(t, "events", "sub-events", "cancel", "gdg-tokyo", "123", "456")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "job-cancel"`) {
		t.Fatalf("output = %s", out)
	}
}
