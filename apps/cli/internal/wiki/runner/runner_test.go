package runner

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestChildEnvStripsRunnerAndGDGVariables(t *testing.T) {
	got := ChildEnv([]string{"PATH=/bin", "RUNNER_TOKEN=secret", "GDG_WIKI_TOKEN=secret", "gdg_wiki_url=x", "HOME=/home/runner"})
	if strings.Join(got, ";") != "PATH=/bin;HOME=/home/runner" {
		t.Fatalf("ChildEnv = %v", got)
	}
}

// The agent process itself must not see the token, or it could push and skip verify-acl.
func TestAgentProcessHasNoRunnerToken(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses env(1)")
	}
	t.Setenv("RUNNER_TOKEN", "0123456789abcdef0123456789abcdef")
	t.Setenv("GDG_WIKI_TOKEN", "0123456789abcdef0123456789abcdef")
	output, err := runAgent(context.Background(), t.TempDir(), 10*time.Second, "env")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output, "RUNNER_TOKEN") || strings.Contains(output, "GDG_") {
		t.Fatalf("agent environment leaks the token:\n%s", output)
	}
	if !strings.Contains(output, "PATH=") {
		t.Fatalf("agent environment lost PATH:\n%s", output)
	}
}

func TestCodexArgsKeepTheSandbox(t *testing.T) {
	args := strings.Join((&CodexBackend{Model: "gpt-x"}).Args("/w", "do it"), " ")
	for _, want := range []string{"exec", "--sandbox workspace-write", "--ignore-user-config", "-C /w", "-m gpt-x"} {
		if !strings.Contains(args, want) {
			t.Fatalf("codex args %q missing %q", args, want)
		}
	}
	if strings.Contains(args, "danger") || strings.Contains(args, "bypass") {
		t.Fatalf("codex args disable the sandbox: %q", args)
	}
	if !strings.HasSuffix(args, "do it") {
		t.Fatalf("prompt must be last: %q", args)
	}
}

func size(n int64) *int64 { return &n }

func TestBatchDocumentsSplitsBySource(t *testing.T) {
	docs := []Document{
		{ID: "a1", SourceID: "a", Bytes: size(3 << 20)},
		{ID: "b1", SourceID: "b", Bytes: size(2 << 20)},
		{ID: "a2", SourceID: "a", Bytes: size(1)},
		{ID: "c1", SourceID: "c", Bytes: size(1 << 20)},
	}
	batches := batchDocuments(docs, 4<<20)
	if len(batches) != 2 || len(batches[0]) != 2 || batches[0][1].ID != "a2" || len(batches[1]) != 2 {
		t.Fatalf("batches = %+v", batches)
	}
}

func TestJobMDCarriesVisibilityAndRequests(t *testing.T) {
	chapter := "tokyo"
	md := renderJobMD(
		Space{Slug: "tokyo", Name: "GDG Tokyo"},
		[]Source{{ID: "src1", Kind: "discord-guild", Title: "Discord", Visibility: "organizer", ChapterID: &chapter}, {ID: "unused", Title: "Other"}},
		[]Document{{ID: "d", SourceID: "src1", Path: "channels/1/2026-11.md", Bytes: size(300 << 10), IsNew: true}},
		map[string]string{"d": "raw/discord/channels/1/2026-11.md"},
		[]Request{{PageSlug: "venue", Text: "会場を更新\n2行目", RequestedByName: "Bob"}},
	)
	for _, want := range []string{"- visibility: organizer", "`src1`", "raw/discord/channels/1/2026-11.md", "heading by heading", "## Requests", "> 2行目", "`venue` — Bob", "`member` sources included"} {
		if !strings.Contains(md, want) {
			t.Fatalf("JOB.md missing %q:\n%s", want, md)
		}
	}
	if strings.Contains(md, "Other") {
		t.Fatalf("JOB.md lists a source with no documents in this batch:\n%s", md)
	}
}

// The wiki requires a span for a `member` source on a restricted page (its readers may be
// outside GDG). Telling the agent "narrower than member" left c-2's job in needs_review.
func TestPromptsAskForSpansOnMemberSources(t *testing.T) {
	for _, name := range []string{"synthesize", "acl-fix"} {
		text := prompt(name)
		if !strings.Contains(text, "`member` included") || strings.Contains(text, "narrower than `member`") {
			t.Fatalf("%s prompt does not ask for spans on member sources:\n%s", name, text)
		}
	}
}

func TestTranslateFrontMatterRoundTrip(t *testing.T) {
	source := renderSource(`会場 "梅田"`, "本文")
	if !strings.HasPrefix(source, "---\ntitle: \"会場 \\\"梅田\\\"\"\n---\n\n本文") {
		t.Fatalf("source = %q", source)
	}
	title, content := parseTarget("---\ntitle: \"Venue \\\"Umeda\\\"\"\n---\n\nBody <acl src=\"x\">secret</acl>\n")
	if title != `Venue "Umeda"` || content != "Body <acl src=\"x\">secret</acl>\n" {
		t.Fatalf("parseTarget = %q, %q", title, content)
	}
	if title, content = parseTarget("no front matter"); title != "" || content != "no front matter\n" {
		t.Fatalf("parseTarget without front matter = %q, %q", title, content)
	}
}

type fakeBackend struct {
	run func(dir, prompt string) error
}

func (f *fakeBackend) Name() string { return "fake" }
func (f *fakeBackend) Run(_ context.Context, dir, prompt string, _ time.Duration) (string, error) {
	return "", f.run(dir, prompt)
}

// A translate job end to end against a fake wiki: lease → page → agent → translation → result.
func TestTranslateJobEndToEnd(t *testing.T) {
	var mu sync.Mutex
	posted := map[string]map[string]any{}
	leased := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer 0123456789abcdef0123456789abcdef" || r.Header.Get("X-Runner-Host") != "vm" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.URL.Path == "/api/runner/jobs/next":
			if leased {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			leased = true
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "j1", "type": "translate", "spaceId": "gdg-jp", "payload": map[string]string{"pageId": "p1", "sourceHash": "h"}})
		case r.URL.Path == "/api/runner/pages/p1":
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "p1", "slug": "venue", "titleJa": "会場", "contentJa": "梅田"})
		case r.Method == http.MethodPost:
			raw, _ := io.ReadAll(r.Body)
			var body map[string]any
			_ = json.Unmarshal(raw, &body)
			posted[r.URL.Path] = body
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	r, err := New(Config{BaseURL: server.URL, Token: "0123456789abcdef0123456789abcdef", Host: "vm", Workdir: t.TempDir(), Once: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.backend = &fakeBackend{run: func(dir, prompt string) error {
		if !strings.Contains(prompt, "target.md") {
			return errors.New("not the translate prompt")
		}
		raw, err := os.ReadFile(filepath.Join(dir, "source.md"))
		if err != nil || !strings.Contains(string(raw), "梅田") {
			return errors.New("source.md missing")
		}
		return os.WriteFile(filepath.Join(dir, "target.md"), []byte("---\ntitle: \"Venue\"\n---\n\nUmeda\n"), 0o644)
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = r.Run(ctx); err != nil {
		t.Fatal(err)
	}
	translation := posted["/api/runner/pages/p1/translation"]
	if translation["titleEn"] != "Venue" || translation["contentEn"] != "Umeda\n" || translation["sourceHash"] != "h" {
		t.Fatalf("translation = %v", translation)
	}
	if result := posted["/api/runner/jobs/j1/result"]; result["status"] != "succeeded" {
		t.Fatalf("result = %v", result)
	}
	if _, err = os.Stat(r.jobDir("j1")); !os.IsNotExist(err) {
		t.Fatalf("job directory not cleaned up: %v", err)
	}
}

func TestCompleteMapsConflictToLeaseLost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"lease_lost"}`, http.StatusConflict)
	}))
	defer server.Close()
	api := &API{BaseURL: server.URL, Token: "t", Host: "vm"}
	if err := api.Complete(context.Background(), "j", Result{Status: "succeeded"}); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("Complete err = %v", err)
	}
}

func TestNewRejectsShortToken(t *testing.T) {
	if _, err := New(Config{Token: "short"}, nil); err == nil {
		t.Fatal("expected an error for a short RUNNER_TOKEN")
	}
}

func TestAnswerArgsAreReadOnlyWithMCP(t *testing.T) {
	args := strings.Join((&CodexBackend{}).AnswerArgs("/w", "q", "/w/s.json", "/w/o.json", &MCPConfig{
		Command: "/usr/local/bin/gdg",
		Args:    []string{"wiki", "mcp", "--spaces", "tokyo"},
		Env:     map[string]string{"GDG_WIKI_JOB_TOKEN": "jt_x"},
	}), " ")
	for _, want := range []string{"--sandbox read-only", "--output-schema /w/s.json", `mcp_servers.wiki.command="/usr/local/bin/gdg"`, `mcp_servers.wiki.args=["wiki","mcp","--spaces","tokyo"]`, `mcp_servers.wiki.env={GDG_WIKI_JOB_TOKEN="jt_x"}`, `mcp_servers.wiki.default_tools_approval_mode="approve"`} {
		if !strings.Contains(args, want) {
			t.Fatalf("answer args %q missing %q", args, want)
		}
	}
	if strings.Contains(args, "workspace-write") || strings.Contains(args, "RUNNER_TOKEN") {
		t.Fatalf("answer runs must be read-only and never carry the runner token: %q", args)
	}
}

func TestAnswerDropsCitationsTheAgentNeverSaw(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "urls.txt")
	_ = os.WriteFile(log, []byte("https://wiki/s/a/wiki/from-mcp\n"), 0o600)
	allowed := allowedURLs(map[string]string{"hits/01.md": "---\nurl: \"https://wiki/s/a/wiki/hit\"\n---\n\nbody"}, log)
	result, err := parseAnswer([]byte(`{"answer":"x","citations":[{"url":"https://wiki/s/a/wiki/hit","quote":""},{"url":"https://wiki/s/a/wiki/from-mcp","quote":""},{"url":"https://evil.example/made-up","quote":""}],"confidence":"high","unanswered":false,"filing":null}`))
	if err != nil {
		t.Fatal(err)
	}
	result = dropUnknownCitations(result, allowed)
	if len(result.Citations) != 2 || result.Filing != nil {
		t.Fatalf("citations = %+v filing=%s", result.Citations, result.Filing)
	}
	only, _ := parseAnswer([]byte(`{"answer":"x","citations":[{"url":"https://evil.example","quote":""}],"confidence":"high","unanswered":false}`))
	if dropped := dropUnknownCitations(only, allowed); len(dropped.Citations) != 0 || dropped.Confidence != "low" {
		t.Fatalf("a fully hallucinated answer must lose its citations and confidence: %+v", dropped)
	}
}

func TestWriteBundleRejectsEscapes(t *testing.T) {
	if err := writeBundle(filepath.Join(t.TempDir(), "b"), map[string]string{"../x.md": "x"}); err == nil {
		t.Fatal("expected an error for a path outside the job directory")
	}
}

func TestRunnerTypesLimitSlots(t *testing.T) {
	got := filterSlots([][]string{{"answer"}, {"synthesize", "translate"}}, []string{"answer", "translate"})
	if len(got) != 2 || got[0][0] != "answer" || len(got[1]) != 1 || got[1][0] != "translate" {
		t.Fatalf("filterSlots = %v", got)
	}
	if _, err := New(Config{Token: strings.Repeat("x", 32), Types: []string{"nope"}}, nil); err == nil {
		t.Fatal("expected an error when RUNNER_TYPES matches nothing")
	}
}
