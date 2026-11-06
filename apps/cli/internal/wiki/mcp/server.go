// Package mcp is `gdg wiki mcp`: a stdio MCP server the runner gives Codex during an
// `answer` job. Its two tools call the wiki's agent read APIs with the job's token, so
// every result is already limited and redacted to the asker's permissions.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type Server struct {
	BaseURL string
	Token   string
	Spaces  []string
	// URLLog, when set, receives every page / source URL a tool returned (one per line).
	// The runner allows citations only from the bundle and this log.
	URLLog     string
	HTTPClient *http.Client

	mu sync.Mutex
}

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

var tools = []map[string]any{
	{
		"name":        "search",
		"description": "Search the wiki spaces of this question. Returns pages (space, slug, title, url, snippets) and short raw source excerpts. Use the returned slugs verbatim with read_page.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"query"},
			"properties": map[string]any{
				"query":  map[string]any{"type": "string"},
				"layers": map[string]any{"type": "string", "description": "comma-separated: page,acl,raw (default all)"},
			},
		},
	},
	{
		"name":        "read_page",
		"description": "Read one wiki page (already redacted for the asker). Do not guess slugs and do not retry a page that was not found.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"space", "slug"},
			"properties": map[string]any{
				"space": map[string]any{"type": "string"},
				"slug":  map[string]any{"type": "string"},
			},
		},
	},
}

// Serve speaks newline-delimited JSON-RPC 2.0 on in/out until in closes.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64<<10), 8<<20)
	encoder := json.NewEncoder(out)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		if len(req.ID) == 0 { // notification
			continue
		}
		result, rpcErr := s.handle(ctx, req)
		if err := encoder.Encode(response{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rpcErr}); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (s *Server) handle(ctx context.Context, req request) (any, *rpcError) {
	switch req.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &params)
		version := params.ProtocolVersion
		if version == "" {
			version = "2025-06-18"
		}
		return map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "gdg-wiki", "version": "1"},
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{"tools": tools}, nil
	case "tools/call":
		var params struct {
			Name      string            `json:"name"`
			Arguments map[string]string `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return nil, &rpcError{Code: -32602, Message: "invalid params"}
		}
		text, isError := s.call(ctx, params.Name, params.Arguments)
		return map[string]any{"content": []map[string]any{{"type": "text", "text": text}}, "isError": isError}, nil
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found"}
	}
}

func (s *Server) call(ctx context.Context, name string, args map[string]string) (string, bool) {
	switch name {
	case "search":
		query := url.Values{"q": {args["query"]}, "limit": {"8"}}
		layers := args["layers"]
		if layers == "" {
			layers = "page,acl,raw"
		}
		query.Set("layers", layers)
		if len(s.Spaces) > 0 {
			query.Set("space", strings.Join(s.Spaces, ","))
		}
		body, err := s.get(ctx, "/api/agent/knowledge-search?"+query.Encode())
		if err != nil {
			return err.Error(), true
		}
		var parsed struct {
			Pages []struct {
				URL string `json:"url"`
			} `json:"pages"`
			Raw []struct {
				URL string `json:"url"`
			} `json:"raw"`
		}
		if json.Unmarshal(body, &parsed) == nil {
			var urls []string
			for _, page := range parsed.Pages {
				urls = append(urls, page.URL)
			}
			for _, raw := range parsed.Raw {
				urls = append(urls, raw.URL)
			}
			s.logURLs(urls...)
		}
		return string(body), false
	case "read_page":
		if !s.spaceAllowed(args["space"]) {
			return "not_found", true
		}
		body, err := s.get(ctx, "/api/agent/page?"+url.Values{"space": {args["space"]}, "slug": {args["slug"]}}.Encode())
		if err != nil {
			return err.Error(), true
		}
		var parsed struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(body, &parsed) == nil {
			s.logURLs(parsed.URL)
		}
		return string(body), false
	default:
		return "unknown tool", true
	}
}

func (s *Server) spaceAllowed(space string) bool {
	if len(s.Spaces) == 0 {
		return space != ""
	}
	for _, allowed := range s.Spaces {
		if allowed == space {
			return true
		}
	}
	return false
}

func (s *Server) get(ctx context.Context, path string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.BaseURL, "/")+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.Token)
	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("not_found")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("wiki error %d", res.StatusCode)
	}
	return body, nil
}

func (s *Server) logURLs(urls ...string) {
	if s.URLLog == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := os.OpenFile(s.URLLog, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	for _, u := range urls {
		if u != "" {
			fmt.Fprintln(file, u)
		}
	}
}
