package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const answerTimeout = 75 * time.Second

type Bundle struct {
	Files    map[string]string `json:"files"`
	JobToken string            `json:"jobToken"`
	Spaces   []string          `json:"spaces"`
}

type AnswerResult struct {
	Answer    string `json:"answer"`
	Citations []struct {
		URL   string `json:"url"`
		Quote string `json:"quote"`
	} `json:"citations"`
	Confidence string          `json:"confidence"`
	Unanswered bool            `json:"unanswered"`
	Filing     json.RawMessage `json:"filing,omitempty"`
	DurationMs int64           `json:"durationMs"`
}

type AnswerBackend interface {
	Answer(ctx context.Context, dir, prompt, schemaPath, outPath string, mcp *MCPConfig, timeout time.Duration) (string, error)
}

type MCPConfig struct {
	Command string
	Args    []string
	Env     map[string]string
}

func (r *Runner) answer(ctx context.Context, job *Job) Result {
	started := time.Now()
	var bundle Bundle
	if _, err := r.api.do(ctx, "GET", "/api/runner/jobs/"+url.PathEscape(job.ID)+"/bundle", nil, &bundle); err != nil {
		return failed(err, false)
	}
	dir := filepath.Join(r.cfg.Workdir, "answer", job.ID)
	defer os.RemoveAll(dir)
	if err := writeBundle(dir, bundle.Files); err != nil {
		return failed(err, false)
	}
	schemaPath := filepath.Join(dir, ".answer.schema.json")
	outPath := filepath.Join(dir, ".answer.json")
	urlLog := filepath.Join(dir, ".mcp-urls.txt")
	schema, _ := prompts.ReadFile("prompts/answer.schema.json")
	if err := os.WriteFile(schemaPath, schema, 0o600); err != nil {
		return failed(err, false)
	}
	mcp := &MCPConfig{
		Command: r.cfg.Executable,
		Args:    []string{"wiki", "mcp", "--spaces", strings.Join(bundle.Spaces, ","), "--url-log", urlLog},
		Env:     map[string]string{"GDG_WIKI_JOB_TOKEN": bundle.JobToken, "GDG_WIKI_URL": r.cfg.BaseURL},
	}
	var raw []byte
	if backend, ok := r.backend.(AnswerBackend); ok {
		if output, err := backend.Answer(ctx, dir, prompt("answer"), schemaPath, outPath, mcp, answerTimeout); err != nil {
			return failed(fmt.Errorf("%w\n%s", err, output), false)
		}
		raw, _ = os.ReadFile(outPath)
	} else {
		fallback := prompt("answer") + "\nWrite the JSON object to `.answer.json`."
		if output, err := r.backend.Run(ctx, dir, fallback, answerTimeout); err != nil {
			return failed(fmt.Errorf("%w\n%s", err, output), false)
		}
		raw, _ = os.ReadFile(outPath)
	}
	result, err := parseAnswer(raw)
	if err != nil {
		return failed(err, false)
	}
	allowed := allowedURLs(bundle.Files, urlLog)
	result = dropUnknownCitations(result, allowed)
	result.DurationMs = time.Since(started).Milliseconds()
	return Result{Status: "succeeded", Result: result}
}

func writeBundle(dir string, files map[string]string) error {
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	for name, content := range files {
		clean := filepath.Clean(name)
		if filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
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

func parseAnswer(raw []byte) (AnswerResult, error) {
	text := strings.TrimSpace(string(raw))
	text = strings.TrimSuffix(strings.TrimPrefix(text, "```json"), "```")
	var result AnswerResult
	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &result); err != nil {
		return AnswerResult{}, fmt.Errorf("agent answer is not valid JSON: %w", err)
	}
	if strings.TrimSpace(result.Answer) == "" {
		return AnswerResult{}, fmt.Errorf("agent answer is empty")
	}
	switch result.Confidence {
	case "high", "medium", "low":
	default:
		result.Confidence = "low"
	}
	if string(result.Filing) == "null" {
		result.Filing = nil
	}
	return result, nil
}

func allowedURLs(files map[string]string, urlLog string) map[string]bool {
	allowed := map[string]bool{}
	for _, content := range files {
		for _, line := range strings.Split(content, "\n") {
			if value, ok := strings.CutPrefix(line, "url: "); ok {
				var decoded string
				if json.Unmarshal([]byte(value), &decoded) == nil && decoded != "" {
					allowed[decoded] = true
				}
			}
		}
	}
	if raw, err := os.ReadFile(urlLog); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				allowed[line] = true
			}
		}
	}
	return allowed
}

func dropUnknownCitations(result AnswerResult, allowed map[string]bool) AnswerResult {
	kept := result.Citations[:0]
	for _, citation := range result.Citations {
		if allowed[citation.URL] {
			kept = append(kept, citation)
		}
	}
	result.Citations = kept
	if len(kept) == 0 && !result.Unanswered {
		result.Confidence = "low"
	}
	return result
}
