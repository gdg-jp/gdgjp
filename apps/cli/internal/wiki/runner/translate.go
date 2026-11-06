package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const translateTimeout = 15 * time.Minute

// translate: one job = one whole page. source.md in, target.md out, POSTed as en only.
func (r *Runner) translate(ctx context.Context, job *Job) Result {
	var payload struct {
		PageID     string `json:"pageId"`
		SourceHash string `json:"sourceHash"`
	}
	if err := json.Unmarshal(job.Payload, &payload); err != nil || payload.PageID == "" {
		return failed(fmt.Errorf("invalid translate payload"), false)
	}
	page, err := r.api.Page(ctx, payload.PageID)
	if err != nil {
		return failed(err, false)
	}
	dir := r.jobDir(job.ID)
	defer os.RemoveAll(dir)
	if err = os.RemoveAll(dir); err == nil {
		err = os.MkdirAll(dir, 0o700)
	}
	if err != nil {
		return failed(err, false)
	}
	if err = os.WriteFile(filepath.Join(dir, "source.md"), []byte(renderSource(page.TitleJa, page.ContentJa)), 0o644); err != nil {
		return failed(err, false)
	}
	if output, runErr := r.backend.Run(ctx, dir, prompt("translate"), translateTimeout); runErr != nil {
		return failed(fmt.Errorf("%w\n%s", runErr, output), false)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "target.md"))
	if err != nil {
		return failed(fmt.Errorf("agent wrote no target.md: %w", err), false)
	}
	title, content := parseTarget(string(raw))
	if strings.TrimSpace(content) == "" {
		return failed(errors.New("target.md is empty"), false)
	}
	if err = r.api.PostTranslation(ctx, page.ID, title, content, payload.SourceHash); err != nil {
		return failed(err, false) // 409 stale_source / 400 acl_required: the nightly cron retries
	}
	return Result{Status: "succeeded", Result: map[string]any{"pageId": page.ID}}
}

// renderSource writes the page with a minimal front matter; the title is a JSON string,
// which is also valid YAML.
func renderSource(title, content string) string {
	encoded, _ := json.Marshal(title)
	return "---\ntitle: " + string(encoded) + "\n---\n\n" + content
}

// parseTarget reads back `title:` from the front matter and the body after it.
func parseTarget(raw string) (title, content string) {
	raw = strings.TrimPrefix(raw, "\ufeff")
	if !strings.HasPrefix(raw, "---\n") {
		return "", strings.TrimSpace(raw) + "\n"
	}
	end := strings.Index(raw[4:], "\n---")
	if end < 0 {
		return "", strings.TrimSpace(raw) + "\n"
	}
	header := raw[4 : 4+end]
	body := strings.TrimPrefix(raw[4+end+4:], "\n")
	for _, line := range strings.Split(header, "\n") {
		value, ok := strings.CutPrefix(line, "title:")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		var decoded string
		if json.Unmarshal([]byte(value), &decoded) == nil {
			value = decoded
		} else {
			value = strings.Trim(value, `'"`)
		}
		title = value
	}
	return title, strings.TrimLeft(body, "\n")
}
