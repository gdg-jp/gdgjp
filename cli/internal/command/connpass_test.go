package command

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/store"
)

func executeConnpass(t *testing.T, args ...string) (string, error) {
	t.Helper()
	command := newConnpassCommand(&memoryCredentialStore{credentials: store.Credentials{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
	}})
	output := new(strings.Builder)
	command.SetOut(output)
	command.SetErr(output)
	command.SetArgs(args)
	err := command.ExecuteContext(context.Background())
	return output.String(), err
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
