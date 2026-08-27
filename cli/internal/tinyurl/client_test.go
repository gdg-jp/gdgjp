package tinyurl

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetLinkErrorEnvelope(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "forbidden"})
	}))
	t.Cleanup(server.Close)

	_, err := NewClientAt(server.URL).GetLink(context.Background(), "token", "link_1")
	httpErr, ok := err.(*HTTPError)
	if !ok {
		t.Fatalf("err = %#v, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusForbidden || httpErr.Message != "forbidden" {
		t.Fatalf("err = %+v", httpErr)
	}
	if want := "tinyurl request failed (403): forbidden"; httpErr.Error() != want {
		t.Fatalf("Error() = %q, want %q", httpErr.Error(), want)
	}
}

func TestListLinksPassthrough(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("folderId") != "3" || r.URL.Query().Get("limit") != "2" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"links":[],"nextCursor":"abc"}`))
	}))
	t.Cleanup(server.Close)

	folderID, limit := 3, 2
	out, err := NewClientAt(server.URL).ListLinks(context.Background(), "token", ListLinksOptions{
		FolderID: &folderID,
		Page:     Page{Limit: &limit},
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"links":[],"nextCursor":"abc"}` {
		t.Fatalf("out = %s", out)
	}
}

func queuedJob(id, status string) map[string]any {
	return map[string]any{
		"id": id, "type": "provision_domain", "status": status, "domainId": 7,
		"request": map[string]any{}, "result": nil, "error": nil,
		"createdBy": "u", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
		"startedAt": nil, "finishedAt": nil,
	}
}

func TestWaitJobTerminatesOnSucceededAndFailed(t *testing.T) {
	t.Parallel()
	for _, terminal := range []string{"succeeded", "failed"} {
		t.Run(terminal, func(t *testing.T) {
			t.Parallel()
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/cli/v1/jobs/j1" {
					t.Fatalf("path = %s", r.URL.Path)
				}
				calls++
				status := "running"
				if calls >= 2 {
					status = terminal
				}
				_ = json.NewEncoder(w).Encode(queuedJob("j1", status))
			}))
			t.Cleanup(server.Close)

			job, err := NewClientAt(server.URL).WaitJob(context.Background(), "token", "j1", time.Millisecond)
			if err != nil {
				t.Fatal(err)
			}
			if string(job.Status) != terminal {
				t.Fatalf("status = %s", job.Status)
			}
			if calls < 2 {
				t.Fatalf("calls = %d, want the loop to poll past the running state", calls)
			}
		})
	}
}

func TestJobFailed(t *testing.T) {
	t.Parallel()
	msg := "provider rejected the hostname"
	if err := JobFailed(Job{Status: JobFailedStatus, Error: &msg}); err == nil || err.Error() != "job failed: "+msg {
		t.Fatalf("err = %v", err)
	}
	if err := JobFailed(Job{Status: JobSucceeded}); err != nil {
		t.Fatalf("err = %v, want nil for a succeeded job", err)
	}
}

func TestValidateAnalyticsWindow(t *testing.T) {
	t.Parallel()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := ValidateAnalyticsWindow(base.AddDate(0, 0, 1), base); err == nil {
		t.Fatal("want an error when --from is after --to")
	}
	if err := ValidateAnalyticsWindow(base, base.AddDate(1, 0, 2)); err == nil {
		t.Fatal("want an error when the range exceeds 366 days")
	}
	if err := ValidateAnalyticsWindow(base, base.AddDate(0, 0, 365)); err != nil {
		t.Fatalf("366-day inclusive window should be allowed: %v", err)
	}
}
