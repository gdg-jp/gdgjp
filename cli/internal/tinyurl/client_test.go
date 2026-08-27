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

func TestCreateDomainReturnsDomainResponse(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/domains" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"domain":{"id":7,"hostname":"go.example.org"}}`))
	}))
	t.Cleanup(server.Close)

	out, err := NewClientAt(server.URL).CreateDomain(context.Background(), "token", map[string]any{
		"hostname": "go.example.org", "chapterId": 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Domain.Id != 7 || out.Domain.Hostname != "go.example.org" {
		t.Fatalf("out = %+v", out)
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
