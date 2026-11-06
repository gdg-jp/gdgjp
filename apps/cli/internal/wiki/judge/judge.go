// Package judge is `gdg wiki judge`: the Stage 06 faithfulness judge. It runs on the
// developer's machine (local `codex exec --sandbox read-only`), never in a Worker.
package judge

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
)

//go:embed judge.md
var prompt string

//go:embed judge.schema.json
var schema []byte

const timeout = 3 * time.Minute

type Verdict struct {
	Verdict     string   `json:"verdict"`
	Evidence    []string `json:"evidence"`
	Unsupported []string `json:"unsupported"`
}

// Backend is the slice of runner.CodexBackend the judge needs.
type Backend interface {
	Answer(ctx context.Context, dir, prompt, schemaPath, outPath string, mcp *runner.MCPConfig, timeout time.Duration) (string, error)
}

// Judge one case. A faithful verdict must quote the evidence verbatim; a verdict with no
// quote, or with a quote that is not in the evidence, counts as unfaithful.
func Judge(ctx context.Context, backend Backend, workdir string, question string, answer json.RawMessage, evidence map[string]string) (Verdict, error) {
	dir, err := os.MkdirTemp(workdir, "judge-")
	if err != nil {
		return Verdict{}, err
	}
	defer os.RemoveAll(dir)
	caseJSON, _ := json.MarshalIndent(map[string]any{"question": question, "answer": answer}, "", "  ")
	if err = os.WriteFile(filepath.Join(dir, "case.json"), caseJSON, 0o600); err != nil {
		return Verdict{}, err
	}
	if err = os.MkdirAll(filepath.Join(dir, "evidence"), 0o700); err != nil {
		return Verdict{}, err
	}
	i := 0
	for url, content := range evidence {
		i++
		body := fmt.Sprintf("url: %s\n\n%s\n", url, content)
		if err = os.WriteFile(filepath.Join(dir, "evidence", fmt.Sprintf("%02d.md", i)), []byte(body), 0o600); err != nil {
			return Verdict{}, err
		}
	}
	schemaPath, outPath := filepath.Join(dir, ".schema.json"), filepath.Join(dir, ".out.json")
	if err = os.WriteFile(schemaPath, schema, 0o600); err != nil {
		return Verdict{}, err
	}
	if output, runErr := backend.Answer(ctx, dir, prompt, schemaPath, outPath, nil, timeout); runErr != nil {
		return Verdict{}, fmt.Errorf("%w\n%s", runErr, output)
	}
	raw, err := os.ReadFile(outPath)
	if err != nil {
		return Verdict{}, err
	}
	var verdict Verdict
	if err = json.Unmarshal(raw, &verdict); err != nil {
		return Verdict{}, fmt.Errorf("judge output is not JSON: %w", err)
	}
	return Enforce(verdict, evidence), nil
}

func normalize(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

// Enforce downgrades a faithful verdict that does not quote the evidence verbatim.
func Enforce(verdict Verdict, evidence map[string]string) Verdict {
	if verdict.Verdict != "faithful" {
		verdict.Verdict = "unfaithful"
		return verdict
	}
	if len(verdict.Evidence) == 0 {
		verdict.Verdict = "unfaithful"
		verdict.Unsupported = append(verdict.Unsupported, "(no supporting quote)")
		return verdict
	}
	corpus := make([]string, 0, len(evidence))
	for _, content := range evidence {
		corpus = append(corpus, normalize(content))
	}
	for _, quote := range verdict.Evidence {
		q := normalize(quote)
		found := q != ""
		if found {
			found = false
			for _, page := range corpus {
				if strings.Contains(page, q) {
					found = true
					break
				}
			}
		}
		if !found {
			verdict.Verdict = "unfaithful"
			verdict.Unsupported = append(verdict.Unsupported, "(quote not in evidence) "+quote)
		}
	}
	return verdict
}

// Results is the eval results file (apps/agent/eval/results/*.json); only the fields the
// judge reads or writes are typed, the rest round-trip untouched.
type Results struct {
	raw     map[string]json.RawMessage
	Results []map[string]json.RawMessage
}

func ReadResults(path string) (*Results, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := &Results{}
	if err = json.Unmarshal(data, &out.raw); err != nil {
		return nil, err
	}
	if err = json.Unmarshal(out.raw["results"], &out.Results); err != nil {
		return nil, fmt.Errorf("results file has no results: %w", err)
	}
	return out, nil
}

func (r *Results) Write(path string, faithfulness float64, judged int) error {
	encoded, err := json.Marshal(r.Results)
	if err != nil {
		return err
	}
	r.raw["results"] = encoded
	var metrics map[string]any
	_ = json.Unmarshal(r.raw["metrics"], &metrics)
	if metrics == nil {
		metrics = map[string]any{}
	}
	if judged > 0 {
		metrics["faithfulness"] = faithfulness
	}
	if r.raw["metrics"], err = json.Marshal(metrics); err != nil {
		return err
	}
	data, err := json.MarshalIndent(r.raw, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
