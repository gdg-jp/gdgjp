package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wikirunner "github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
)

// Bundle is what the pr Worker prepared for one job: the Skill, the parts of the Playbook it
// reads, the brief and the task, as files; plus the prompt and the output schema's path.
type Bundle struct {
	Files          map[string]string `json:"files"`
	Prompt         string            `json:"prompt"`
	Skill          string            `json:"skill"`
	Kind           string            `json:"kind"`
	TimeoutSeconds int               `json:"timeoutSeconds"`
}

// JobOutput is the result body the Worker imports: the agent's JSON and the runner's checks.
type JobOutput struct {
	Output json.RawMessage `json:"output"`
	Checks Checks          `json:"checks"`
}

type Checks struct {
	Yomiyasu CheckResult `json:"yomiyasu"`
}

type CheckResult struct {
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

func (r *Runner) handle(ctx context.Context, job *wikirunner.Job) wikirunner.Result {
	bundle, err := r.fetchBundle(ctx, job.ID)
	if err != nil {
		return failed(err, true)
	}
	dir := filepath.Join(r.cfg.Workdir, "jobs", job.ID)
	defer os.RemoveAll(dir)
	if err := WriteBundle(dir, bundle.Files); err != nil {
		return failed(err, false)
	}
	schema, ok := bundle.Files["skills/"+bundle.Skill+"/references/output.schema.json"]
	if !ok {
		return failed(fmt.Errorf("bundle has no output schema for %s", bundle.Skill), false)
	}
	schemaPath := filepath.Join(dir, ".output.schema.json")
	outPath := filepath.Join(dir, ".output.json")
	if err := os.WriteFile(schemaPath, []byte(schema), 0o600); err != nil {
		return failed(err, false)
	}
	structured, ok := r.backend.(wikirunner.AnswerBackend)
	if !ok {
		return failed(fmt.Errorf("backend %s cannot run read-only with an output schema", r.backend.Name()), false)
	}
	timeout := time.Duration(bundle.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	if output, err := structured.Answer(ctx, dir, bundle.Prompt, schemaPath, outPath, nil, timeout); err != nil {
		return failed(fmt.Errorf("%w\n%s", err, output), false)
	}
	raw, err := os.ReadFile(outPath)
	if err != nil {
		return failed(fmt.Errorf("agent wrote no output: %w", err), false)
	}
	output, err := parseOutput(raw)
	if err != nil {
		return failed(err, false)
	}
	return wikirunner.Result{
		Status: "succeeded",
		Result: JobOutput{Output: output, Checks: Checks{Yomiyasu: Yomiyasu(ctx, r.cfg, output, []byte(bundle.Files["BRIEF.json"]))}},
	}
}

// parseOutput accepts the agent's final message with or without a ```json fence.
func parseOutput(raw []byte) (json.RawMessage, error) {
	text := strings.TrimSpace(string(raw))
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	var probe map[string]any
	if err := json.Unmarshal([]byte(text), &probe); err != nil {
		return nil, fmt.Errorf("agent output is not a JSON object: %w", err)
	}
	return json.RawMessage(text), nil
}

// WriteBundle writes the bundle's files under dir, refusing any path that escapes it.
func WriteBundle(dir string, files map[string]string) error {
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	for name, content := range files {
		clean := filepath.Clean(name)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
			return fmt.Errorf("bundle path %q escapes the job directory", name)
		}
		path := filepath.Join(dir, clean)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			return err
		}
	}
	return nil
}

func (r *Runner) fetchBundle(ctx context.Context, jobID string) (*Bundle, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(r.cfg.BaseURL, "/")+"/api/runner/jobs/"+url.PathEscape(jobID)+"/bundle", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+r.cfg.Token)
	req.Header.Set("X-Runner-Host", r.cfg.Host)
	res, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("bundle %d: %s", res.StatusCode, bytes.TrimSpace(body))
	}
	var bundle Bundle
	if err := json.Unmarshal(body, &bundle); err != nil {
		return nil, fmt.Errorf("decode bundle: %w", err)
	}
	return &bundle, nil
}
