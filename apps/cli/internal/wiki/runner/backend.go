package runner

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

type Backend interface {
	Name() string
	Run(ctx context.Context, dir, prompt string, timeout time.Duration) (string, error)
}

func NewBackend(name, model string) (Backend, error) {
	switch name {
	case "", "codex":
		return &CodexBackend{Model: model}, nil
	case "gemini":
		return &GeminiBackend{Model: model}, nil
	default:
		return nil, fmt.Errorf("unknown RUNNER_BACKEND %q (codex or gemini)", name)
	}
}

func ChildEnv(environ []string) []string {
	out := make([]string, 0, len(environ))
	for _, entry := range environ {
		name, _, _ := strings.Cut(entry, "=")
		upper := strings.ToUpper(name)
		if strings.HasPrefix(upper, "RUNNER_") || strings.HasPrefix(upper, "GDG_") {
			continue
		}
		out = append(out, entry)
	}
	return out
}

func runAgent(ctx context.Context, dir string, timeout time.Duration, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = ChildEnv(os.Environ())
	cmd.Stdin = nil
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return tail(output), fmt.Errorf("%s timed out after %s", name, timeout)
	}
	if err != nil {
		return tail(output), fmt.Errorf("%s: %w", name, err)
	}
	return tail(output), nil
}

func tail(output []byte) string {
	const max = 4000
	if len(output) > max {
		output = output[len(output)-max:]
	}
	return string(output)
}
