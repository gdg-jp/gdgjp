package agenthost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ExecResource runs a command only when a designated watch file has changed.
// Unconditional execution is strictly disallowed to prevent repeated expensive commands like npm ci.
type ExecResource struct {
	Name           string
	Command        []string
	Dir            string
	WatchFile      string
	StateFile      string
	CheckDir       string
	ChmodRecursive string
	Prefix         string
}

func (e *ExecResource) ID() string {
	return e.Name
}

func (e *ExecResource) ResourceType() string {
	return "exec"
}

func (e *ExecResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   e.ID(),
		ResourceType: e.ResourceType(),
		Action:       ActionNone,
	}

	if e.Prefix != "" {
		return ch, nil
	}

	if e.WatchFile == "" || e.StateFile == "" {
		return ch, fmt.Errorf("ExecResource %q requires non-empty WatchFile and StateFile to prevent unconditional execution", e.Name)
	}

	// Check if target directory/artifacts (e.g. node_modules) is missing
	if e.CheckDir != "" {
		if _, err := os.Stat(e.CheckDir); err != nil && os.IsNotExist(err) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("+ exec %s in %s (%s missing)", strings.Join(e.Command, " "), e.Dir, e.CheckDir)
			return ch, nil
		}
	}

	watchData, err := os.ReadFile(e.WatchFile)
	if err != nil {
		if os.IsNotExist(err) {
			// Watch file does not exist yet (e.g. repository not yet cloned/checked out in this run)
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("+ exec %s in %s (pending %s creation)", strings.Join(e.Command, " "), e.Dir, filepath.Base(e.WatchFile))
			return ch, nil
		}
		return ch, err
	}

	hasher := sha256.New()
	hasher.Write(watchData)
	currentSHA := hex.EncodeToString(hasher.Sum(nil))

	recordedSHABytes, err := os.ReadFile(e.StateFile)
	if err != nil {
		if os.IsNotExist(err) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("+ exec %s in %s (initial state)", strings.Join(e.Command, " "), e.Dir)
			return ch, nil
		}
		return ch, err
	}

	recordedSHA := strings.TrimSpace(string(recordedSHABytes))
	if recordedSHA != currentSHA {
		ch.Action = ActionUpdate
		ch.Diff = fmt.Sprintf("~ exec %s in %s (%s hash changed)", strings.Join(e.Command, " "), e.Dir, filepath.Base(e.WatchFile))
		return ch, nil
	}

	return ch, nil
}

func (e *ExecResource) Apply(ctx context.Context, c Change) error {
	if e.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	if len(e.Command) == 0 {
		return fmt.Errorf("empty command in ExecResource %q", e.Name)
	}

	cmd := exec.CommandContext(ctx, e.Command[0], e.Command[1:]...)
	cmd.Dir = e.Dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Retry once with clean CheckDir if configured (e.g. rm -rf node_modules && npm ci)
		if e.CheckDir != "" {
			_ = os.RemoveAll(e.CheckDir)
			retryCmd := exec.CommandContext(ctx, e.Command[0], e.Command[1:]...)
			retryCmd.Dir = e.Dir
			outRetry, errRetry := retryCmd.CombinedOutput()
			if errRetry != nil {
				return fmt.Errorf("exec %s in %s failed after retry: %w (%s)", strings.Join(e.Command, " "), e.Dir, errRetry, string(outRetry))
			}
		} else {
			return fmt.Errorf("exec %s in %s failed: %w (%s)", strings.Join(e.Command, " "), e.Dir, err, string(out))
		}
	}

	if e.ChmodRecursive != "" {
		if out, err := exec.CommandContext(ctx, "chmod", "-R", "a+rX", e.ChmodRecursive).CombinedOutput(); err != nil {
			return fmt.Errorf("chmod -R a+rX %s failed: %w (%s)", e.ChmodRecursive, err, strings.TrimSpace(string(out)))
		}
	}

	watchData, err := os.ReadFile(e.WatchFile)
	if err != nil {
		return fmt.Errorf("reading watch file %s after exec failed: %w", e.WatchFile, err)
	}

	hasher := sha256.New()
	hasher.Write(watchData)
	currentSHA := hex.EncodeToString(hasher.Sum(nil))

	if err := os.MkdirAll(filepath.Dir(e.StateFile), 0o755); err != nil {
		return fmt.Errorf("creating state directory for %s failed: %w", e.StateFile, err)
	}
	if err := os.WriteFile(e.StateFile, []byte(currentSHA+"\n"), 0o644); err != nil {
		return fmt.Errorf("writing state file %s failed: %w", e.StateFile, err)
	}

	return nil
}
