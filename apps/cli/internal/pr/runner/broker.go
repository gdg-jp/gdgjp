package runner

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// broker is the render broker (skills/pr-playbook/scripts/render/broker.mjs) running outside the
// agent's sandbox: Codex's sandbox cannot start Chromium, so the agent writes a page under
// <job>/.render and the broker, started here with the VM's Playwright, writes the PNG back.
type broker struct {
	cmd  *exec.Cmd
	done chan struct{}
}

// startBroker runs the broker from the bundle's own script with GDG_RENDER_DIR's Playwright and
// waits until it reports "ready" (the browser is up).
func startBroker(ctx context.Context, dir string, cfg Config, logger *log.Logger) (*broker, error) {
	script := filepath.Join(dir, "skills", "pr-playbook", "scripts", "render", "broker.mjs")
	if _, err := os.Stat(script); err != nil {
		return nil, fmt.Errorf("bundle has no broker script: %w", err)
	}
	queue := filepath.Join(dir, ".render")
	if err := os.MkdirAll(queue, 0o700); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "node", script, "--queue", queue, "--fonts", cfg.FontsDir, "--render-dir", cfg.RenderDir)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GDG_RENDER_DIR="+cfg.RenderDir,
		"PLAYWRIGHT_BROWSERS_PATH="+filepath.Join(cfg.RenderDir, "browsers"),
		"NODE_PATH="+filepath.Join(cfg.RenderDir, "node_modules"),
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = &prefixWriter{logger: logger, prefix: "broker: "}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	b := &broker{cmd: cmd, done: make(chan struct{})}
	ready := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "ready" {
				select {
				case ready <- line:
				default:
				}
			} else if line != "" {
				logger.Printf("broker: %s", line)
			}
		}
	}()
	go func() {
		_ = cmd.Wait()
		close(b.done)
	}()
	select {
	case <-ready:
		return b, nil
	case <-b.done:
		return nil, fmt.Errorf("broker exited before it was ready")
	case <-time.After(90 * time.Second):
		b.stop()
		return nil, fmt.Errorf("broker did not become ready in 90s")
	}
}

func (b *broker) stop() {
	if b == nil || b.cmd.Process == nil {
		return
	}
	_ = b.cmd.Process.Signal(os.Interrupt)
	select {
	case <-b.done:
	case <-time.After(10 * time.Second):
		_ = b.cmd.Process.Kill()
		<-b.done
	}
}

type prefixWriter struct {
	logger *log.Logger
	prefix string
}

func (w *prefixWriter) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimRight(string(p), "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			w.logger.Printf("%s%s", w.prefix, line)
		}
	}
	return len(p), nil
}
