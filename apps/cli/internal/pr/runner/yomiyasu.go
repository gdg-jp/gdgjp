package runner

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var japanese = regexp.MustCompile(`[\p{Hiragana}\p{Katakana}\p{Han}]`)

// skipKeys mirrors japaneseTexts in skills/pr-playbook/scripts/checks/util.mjs: markup and the
// author's own notes are not prose to proofread.
var skipKeys = map[string]bool{"html": true, "metaThemeMapping": true, "rationaleMd": true, "textAboveFold": true, "textBelowFold": true}

// JapaneseTexts collects every string leaf with kana or kanji.
func JapaneseTexts(value any, key string) []string {
	if skipKeys[key] {
		return nil
	}
	switch v := value.(type) {
	case string:
		if japanese.MatchString(v) {
			return []string{v}
		}
	case []any:
		var out []string
		for _, item := range v {
			out = append(out, JapaneseTexts(item, key)...)
		}
		return out
	case map[string]any:
		var out []string
		for k, item := range v {
			out = append(out, JapaneseTexts(item, k)...)
		}
		return out
	}
	return nil
}

func yomiyasuState(cfg Config) string {
	if cfg.YomiyasuDir == "" {
		return "missing"
	}
	if _, err := os.Stat(filepath.Join(cfg.YomiyasuDir, "scripts", "yomiyasu_check.py")); err != nil {
		return "missing (" + cfg.YomiyasuDir + ")"
	}
	return "ok"
}

// Yomiyasu runs `yomiyasu_check.py run --fail-on error` on the output's Japanese prose, with
// the brief as material. Missing tool or Python → unevaluated (the Worker shows it as such).
func Yomiyasu(ctx context.Context, cfg Config, output json.RawMessage, brief []byte) CheckResult {
	if yomiyasuState(cfg) != "ok" {
		return CheckResult{Status: "unevaluated", Detail: "yomiyasu が見つからない"}
	}
	var value any
	if err := json.Unmarshal(output, &value); err != nil {
		return CheckResult{Status: "unevaluated", Detail: "output is not JSON"}
	}
	texts := JapaneseTexts(value, "")
	if len(texts) == 0 {
		return CheckResult{Status: "pass", Detail: "日本語の本文なし"}
	}
	dir, err := os.MkdirTemp("", "pr-yomiyasu-")
	if err != nil {
		return CheckResult{Status: "unevaluated", Detail: err.Error()}
	}
	defer os.RemoveAll(dir)
	final := filepath.Join(dir, "final.txt")
	material := filepath.Join(dir, "material.txt")
	_ = os.WriteFile(final, []byte(strings.Join(texts, "\n\n")+"\n"), 0o600)
	_ = os.WriteFile(material, brief, 0o600)
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	python := cfg.Python
	if python == "" {
		python = "python3"
	}
	cmd := exec.CommandContext(ctx, python, filepath.Join(cfg.YomiyasuDir, "scripts", "yomiyasu_check.py"), "run",
		"--final", final, "--material", material, "--doc-type", "promo", "--fail-on", "error", "--no-record", "--json")
	cmd.Dir = dir
	out, err := cmd.Output()
	var parsed struct {
		Lint struct {
			Counts struct {
				Error int `json:"error"`
				Warn  int `json:"warn"`
			} `json:"counts"`
		} `json:"lint"`
	}
	_ = json.Unmarshal(out, &parsed)
	detail := ""
	if len(out) > 0 {
		detail = "error " + strconv.Itoa(parsed.Lint.Counts.Error) + " / warn " + strconv.Itoa(parsed.Lint.Counts.Warn)
	}
	if err == nil {
		return CheckResult{Status: "pass", Detail: detail}
	}
	if exit, ok := err.(*exec.ExitError); ok && exit.ExitCode() == 1 {
		return CheckResult{Status: "fail", Detail: "yomiyasu の指摘あり（" + detail + "）"}
	}
	return CheckResult{Status: "unevaluated", Detail: "yomiyasu を実行できなかった: " + err.Error()}
}
