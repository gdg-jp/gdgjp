package runner

import (
	"context"
	"time"
)

// CodexBackend runs `codex exec` on the shared VM's personal ChatGPT Pro login
// (~/.codex/auth.json); never an API key. workspace-write keeps writes inside dir and the
// network off, and `exec` never asks for approval.
type CodexBackend struct{ Model string }

func (b *CodexBackend) Name() string { return "codex" }

func (b *CodexBackend) Args(dir, prompt string) []string {
	args := []string{"exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--ephemeral", "--color", "never", "-C", dir}
	if b.Model != "" {
		args = append(args, "-m", b.Model)
	}
	return append(args, prompt)
}

func (b *CodexBackend) Run(ctx context.Context, dir, prompt string, timeout time.Duration) (string, error) {
	return runAgent(ctx, dir, timeout, "codex", b.Args(dir, prompt)...)
}
