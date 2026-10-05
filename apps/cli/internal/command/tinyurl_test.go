package command

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func executeTinyurl(t *testing.T, credentials store.CredentialStore, args ...string) (string, error) {
	t.Helper()
	command := newTinyurlCommand(credentials)
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	command.SilenceUsage = true
	command.SilenceErrors = true
	err := command.ExecuteContext(context.Background())
	return output.String(), err
}

func defaultTinyurlCredentialStore() *memoryCredentialStore {
	return &memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	}}
}

func TestTinyurlLinksCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/links" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["domainId"] != float64(4) || payload["slug"] != "launch" ||
			payload["destinationUrl"] != "https://example.org" || payload["visibility"] != "public" {
			t.Fatalf("payload = %#v", payload)
		}
		if tags, ok := payload["tagIds"].([]any); !ok || len(tags) != 2 {
			t.Fatalf("tagIds = %#v", payload["tagIds"])
		}
		shares, ok := payload["shares"].([]any)
		if !ok || len(shares) != 1 {
			t.Fatalf("shares = %#v", payload["shares"])
		}
		share := shares[0].(map[string]any)
		if share["principalType"] != "user" || share["principalId"] != "a@b.com" || share["role"] != "editor" {
			t.Fatalf("share = %#v", share)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"link":{"id":"link_1","slug":"launch"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(),
		"links", "create", "--domain-id", "4", "--slug", "launch", "--url", "https://example.org",
		"--visibility", "public", "--tag-id", "1", "--tag-id", "2", "--share", "user:a@b.com:editor")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": "link_1"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlLinksListQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/v1/links" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.URL.Query().Get("folderId") != "9" || r.URL.Query().Get("limit") != "5" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"links":[],"nextCursor":null}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(), "links", "list", "--folder-id", "9", "--limit", "5")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"nextCursor": null`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlTagsCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/tags" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["name"] != "release" || payload["color"] != "#ff0000" {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"tag":{"id":3,"name":"release"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(), "tags", "create", "--name", "release", "--color", "#ff0000")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": 3`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlDomainsCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/domains" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["hostname"] != "go.example.org" || payload["chapterId"] != float64(2) {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"domain":{"id":7,"hostname":"go.example.org","status":"verifying"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(),
		"domains", "create", "--hostname", "go.example.org", "--chapter-id", "2")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"status": "verifying"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlDomainsSync(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/domains/7/sync" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"domain":{"id":7,"hostname":"go.example.org","status":"active"}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(), "domains", "sync", "7")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"status": "active"`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlCampaignsAnalyticsWindowValidation(t *testing.T) {
	// The server must never be hit: validation happens CLI-side first.
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	_, err := executeTinyurl(t, defaultTinyurlCredentialStore(),
		"campaigns", "analytics", "5", "--from", "2026-02-01T00:00:00Z", "--to", "2026-01-01T00:00:00Z")
	if err == nil || !strings.Contains(err.Error(), "--from must not be after --to") {
		t.Fatalf("err = %v", err)
	}

	_, err = executeTinyurl(t, defaultTinyurlCredentialStore(),
		"campaigns", "analytics", "5", "--from", "2026-01-01T00:00:00Z", "--to", "2027-06-01T00:00:00Z")
	if err == nil || !strings.Contains(err.Error(), "cannot exceed 366 days") {
		t.Fatalf("err = %v", err)
	}
}

func TestTinyurlCampaignsAnalytics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/cli/v1/campaigns/5/analytics" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		q := r.URL.Query()
		if q.Get("from") == "" || q.Get("to") == "" || q.Get("bucket") != "day" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"analytics": map[string]any{
			"totalClicks": 12, "trend": []any{}, "links": []any{}, "sources": []any{}, "acquisition": nil,
		}})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(),
		"campaigns", "analytics", "5",
		"--from", "2026-01-01T00:00:00Z", "--to", "2026-01-15T00:00:00Z", "--bucket", "day")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"totalClicks": 12`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlCampaignChannelsCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/cli/v1/campaigns/5/channels" {
			t.Fatalf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		if payload["name"] != "Newsletter" || payload["code"] != "nl" {
			t.Fatalf("payload = %#v", payload)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{"channel": map[string]any{"id": 8, "name": "Newsletter"}})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	out, err := executeTinyurl(t, defaultTinyurlCredentialStore(),
		"campaigns", "channels", "create", "--campaign-id", "5", "--name", "Newsletter", "--code", "nl")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"id": 8`) {
		t.Fatalf("output = %s", out)
	}
}

func TestTinyurlDomainsDeleteRetriesOnceOn401(t *testing.T) {
	var tokensSeen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		tokensSeen = append(tokensSeen, token)
		if token != "new-access" {
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": "expired"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 3, "deleted": true})
	}))
	t.Cleanup(server.Close)
	t.Setenv("GDG_TINYURL_URL", server.URL)

	restore := cliutil.SetRefreshForTesting(func(_ context.Context, refreshToken string) (store.Credentials, error) {
		if refreshToken != "refresh-token" {
			t.Fatalf("refresh token = %q", refreshToken)
		}
		return store.Credentials{AccessToken: "new-access", RefreshToken: "new-refresh"}, nil
	})
	t.Cleanup(restore)

	credentials := &memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "old-access",
		RefreshToken: "refresh-token",
	}}
	out, err := executeTinyurl(t, credentials, "domains", "delete", "3")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"deleted": true`) {
		t.Fatalf("output = %s", out)
	}
	if len(tokensSeen) != 2 || tokensSeen[0] != "old-access" || tokensSeen[1] != "new-access" {
		t.Fatalf("tokens seen = %#v, want exactly [old-access new-access]", tokensSeen)
	}
}
