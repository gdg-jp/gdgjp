package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeToolsWithJobToken(t *testing.T) {
	var seenAuth []string
	wiki := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth = append(seenAuth, r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/api/agent/knowledge-search":
			if r.URL.Query().Get("space") != "tokyo" {
				t.Errorf("search space = %q", r.URL.Query().Get("space"))
			}
			_, _ = w.Write([]byte(`{"pages":[{"url":"https://wiki/s/tokyo/wiki/venue"}],"raw":[]}`))
		case "/api/agent/page":
			_, _ = w.Write([]byte(`{"url":"https://wiki/s/tokyo/wiki/venue","content":"[非公開]"}`))
		}
	}))
	defer wiki.Close()
	log := filepath.Join(t.TempDir(), "urls.txt")
	server := &Server{BaseURL: wiki.URL, Token: "jt_abc", Spaces: []string{"tokyo"}, URLLog: log}
	in := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search","arguments":{"query":"会場"}}}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_page","arguments":{"space":"tokyo","slug":"venue"}}}`,
		`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"read_page","arguments":{"space":"other","slug":"x"}}}`,
	}, "\n")
	var out bytes.Buffer
	if err := server.Serve(context.Background(), strings.NewReader(in), &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 5 {
		t.Fatalf("responses = %d:\n%s", len(lines), out.String())
	}
	var last struct {
		Result struct {
			IsError bool `json:"isError"`
		} `json:"result"`
	}
	_ = json.Unmarshal([]byte(lines[4]), &last)
	if !last.Result.IsError {
		t.Fatal("read_page outside the job's spaces must fail")
	}
	for _, auth := range seenAuth {
		if auth != "Bearer jt_abc" {
			t.Fatalf("wiki called with %q", auth)
		}
	}
	raw, _ := os.ReadFile(log)
	if strings.Count(string(raw), "https://wiki/s/tokyo/wiki/venue") != 2 {
		t.Fatalf("url log = %q", raw)
	}
}
