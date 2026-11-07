package runner

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	wikirunner "github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
)

// fakeBackend is a read-only agent that answers with a fixed JSON object.
type fakeBackend struct {
	output    string
	gotPrompt string
	gotDir    string
	sawFiles  []string
}

func (f *fakeBackend) Name() string { return "fake" }
func (f *fakeBackend) Run(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}
func (f *fakeBackend) Answer(_ context.Context, dir, prompt, schemaPath, outPath string, _ *wikirunner.MCPConfig, _ time.Duration) (string, error) {
	f.gotPrompt, f.gotDir = prompt, dir
	_ = filepath.Walk(dir, func(path string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() {
			rel, _ := filepath.Rel(dir, path)
			f.sawFiles = append(f.sawFiles, rel)
		}
		return nil
	})
	if _, err := os.Stat(schemaPath); err != nil {
		return "", err
	}
	return "", os.WriteFile(outPath, []byte(f.output), 0o600)
}

const token = "test-runner-token-0123456789abcdef0123"

func server(t *testing.T, bundle Bundle) (*httptest.Server, *wikirunner.Result) {
	t.Helper()
	var (
		mu     sync.Mutex
		leased bool
		got    wikirunner.Result
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.URL.Path == "/api/runner/heartbeat":
			_, _ = w.Write([]byte(`{"ok":true}`))
		case r.URL.Path == "/api/runner/jobs/next":
			if leased {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			leased = true
			_, _ = w.Write([]byte(`{"id":"job_1","type":"post","spaceId":"7","payload":{}}`))
		case r.URL.Path == "/api/runner/jobs/job_1/bundle":
			_ = json.NewEncoder(w).Encode(bundle)
		case r.URL.Path == "/api/runner/jobs/job_1/result":
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &got)
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func TestRunnerServesOneJobAndReturnsTheAgentJSON(t *testing.T) {
	bundle := Bundle{
		Files: map[string]string{
			"JOB.md":                    "# job",
			"BRIEF.json":                `{"event":{"name":"DevFest"}}`,
			"skills/pr-x-post/SKILL.md": "skill",
			"skills/pr-x-post/references/output.schema.json": `{"type":"object"}`,
		},
		Prompt: "do it", Skill: "pr-x-post", Kind: "x_post", TimeoutSeconds: 30,
	}
	srv, got := server(t, bundle)
	backend := &fakeBackend{output: "```json\n{\"channel\":\"x\",\"posts\":[{\"text\":\"告知です\"}],\"notes\":null}\n```"}
	cfg := Config{BaseURL: srv.URL, Token: token, Workdir: t.TempDir(), Host: "test", Once: true, YomiyasuDir: filepath.Join(t.TempDir(), "none")}
	r := NewWithBackend(cfg, backend, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := r.Run(ctx); err != nil {
		t.Fatal(err)
	}
	if got.Status != "succeeded" {
		t.Fatalf("status = %q (%s)", got.Status, got.Error)
	}
	raw, _ := json.Marshal(got.Result)
	if !strings.Contains(string(raw), `"channel":"x"`) || !strings.Contains(string(raw), `"status":"unevaluated"`) {
		t.Fatalf("result = %s", raw)
	}
	if backend.gotPrompt != "do it" {
		t.Fatalf("prompt = %q", backend.gotPrompt)
	}
	joined := strings.Join(backend.sawFiles, ",")
	for _, want := range []string{"JOB.md", "BRIEF.json", "skills/pr-x-post/SKILL.md", ".output.schema.json"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("agent did not see %s (saw %s)", want, joined)
		}
	}
	if _, err := os.Stat(backend.gotDir); !os.IsNotExist(err) {
		t.Fatalf("job directory was not removed")
	}
}

func TestWriteBundleRefusesPathsOutsideTheJobDirectory(t *testing.T) {
	for _, bad := range []string{"../escape.txt", "/etc/passwd", "a/../../b"} {
		if err := WriteBundle(t.TempDir(), map[string]string{bad: "x"}); err == nil {
			t.Fatalf("%q was written", bad)
		}
	}
}

func TestAgentEnvironmentDropsRunnerSecrets(t *testing.T) {
	env := wikirunner.ChildEnv([]string{"RUNNER_TOKEN=x", "GDG_PR_URL=y", "HOME=/home/runner"})
	if strings.Join(env, ",") != "HOME=/home/runner" {
		t.Fatalf("env = %v", env)
	}
}

func TestJapaneseTextsSkipsMarkup(t *testing.T) {
	var value any
	_ = json.Unmarshal([]byte(`{"html":"<p>本文</p>","posts":[{"text":"告知です","textAboveFold":"告知"}],"url":"https://x"}`), &value)
	got := JapaneseTexts(value, "")
	if len(got) != 1 || got[0] != "告知です" {
		t.Fatalf("got %v", got)
	}
}

func TestParseOutputRejectsNonObjects(t *testing.T) {
	if _, err := parseOutput([]byte("not json")); err == nil {
		t.Fatal("accepted text")
	}
	if _, err := parseOutput([]byte("```json\n{\"a\":1}\n```")); err != nil {
		t.Fatal(err)
	}
}

// imageBackend also attaches images (as codex does).
type imageBackend struct {
	fakeBackend
	gotImages []string
	imageSize int
}

func (b *imageBackend) AnswerWithImages(ctx context.Context, dir, prompt, schemaPath, outPath string, images []string, timeout time.Duration) (string, error) {
	b.gotImages = images
	if len(images) > 0 {
		if info, err := os.Stat(images[0]); err == nil {
			b.imageSize = int(info.Size())
		}
	}
	return b.Answer(ctx, dir, prompt, schemaPath, outPath, nil, timeout)
}

func TestRunnerWritesImagesAndAttachesThem(t *testing.T) {
	bundle := Bundle{
		Files: map[string]string{
			"JOB.md": "# job",
			"skills/pr-assist/references/output.schema.json": `{"type":"object"}`,
		},
		// "PNG!" in base64
		BinaryFiles: map[string]string{"sources/1/src-1-1.png": "UE5HIQ=="},
		Images:      []string{"sources/1/src-1-1.png", "missing.png"},
		Prompt:      "read", Skill: "pr-assist", Kind: "assist", TimeoutSeconds: 30,
	}
	srv, got := server(t, bundle)
	backend := &imageBackend{fakeBackend: fakeBackend{output: `{"reply":"読みました"}`}}
	cfg := Config{BaseURL: srv.URL, Token: token, Workdir: t.TempDir(), Host: "test", Once: true, YomiyasuDir: filepath.Join(t.TempDir(), "none")}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := NewWithBackend(cfg, backend, nil).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if got.Status != "succeeded" {
		t.Fatalf("status = %q (%s)", got.Status, got.Error)
	}
	if len(backend.gotImages) != 1 || !strings.HasSuffix(backend.gotImages[0], "sources/1/src-1-1.png") || backend.imageSize != 4 {
		t.Fatalf("images = %v (size %d)", backend.gotImages, backend.imageSize)
	}
}

func TestWriteBinaryRefusesPathsOutsideTheJobDirectory(t *testing.T) {
	if err := WriteBinary(t.TempDir(), map[string]string{"../x.png": "UE5HIQ=="}); err == nil {
		t.Fatal("escaped")
	}
}
