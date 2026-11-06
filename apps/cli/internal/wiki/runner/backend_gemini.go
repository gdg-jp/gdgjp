package runner

import (
	"context"
	"time"
)

// GeminiBackend is the fallback when the Codex quota is out: the Gemini CLI on its own
// login, editing files in dir only (`--yolo` auto-approves edits inside the sandbox).
type GeminiBackend struct{ Model string }

func (b *GeminiBackend) Name() string { return "gemini" }

func (b *GeminiBackend) Run(ctx context.Context, dir, prompt string, timeout time.Duration) (string, error) {
	args := []string{"--sandbox", "--yolo"}
	if b.Model != "" {
		args = append(args, "-m", b.Model)
	}
	args = append(args, "-p", prompt)
	return runAgent(ctx, dir, timeout, "gemini", args...)
}
