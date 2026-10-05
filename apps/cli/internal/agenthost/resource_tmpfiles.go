package agenthost

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// TmpfilesResource writes systemd-tmpfiles configurations and creates directories on change.
type TmpfilesResource struct {
	Path   string
	Data   []byte
	Prefix string
}

func (t *TmpfilesResource) ID() string {
	return t.Path
}

func (t *TmpfilesResource) ResourceType() string {
	return "tmpfiles"
}

func (t *TmpfilesResource) Plan(_ context.Context) (Change, error) {
	info, err := os.Lstat(t.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   t.Path,
				ResourceType: t.ResourceType(),
				Action:       ActionCreate,
				Diff:         fmt.Sprintf("+ tmpfiles %s (mode 0444)", t.Path),
			}, nil
		}
		return Change{}, err
	}

	existing, err := os.ReadFile(t.Path)
	if err != nil {
		return Change{}, err
	}

	action := ActionNone
	var diffs []string
	if !bytes.Equal(existing, t.Data) {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ content (%d bytes -> %d bytes)", len(existing), len(t.Data)))
	}
	currentMode := info.Mode().Perm()
	if currentMode != 0o444 {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ mode %04o -> 0444", currentMode))
	}

	diffText := ""
	if len(diffs) > 0 {
		diffText = fmt.Sprintf("~ tmpfiles %s:\n    %s", t.Path, joinDiffs(diffs))
	}

	return Change{
		ResourceID:   t.Path,
		ResourceType: t.ResourceType(),
		Action:       action,
		Diff:         diffText,
	}, nil
}

func (t *TmpfilesResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	dir := filepath.Dir(t.Path)
	if err := mkdirMode(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".gdg-agent.tmp.")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = tmp.Close()
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(t.Data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o444); err != nil {
		return err
	}
	if err := os.Rename(tmpName, t.Path); err != nil {
		return err
	}
	cleanup = false

	if t.Prefix == "" && os.Getuid() == 0 {
		if bin, lookErr := exec.LookPath("systemd-tmpfiles"); lookErr == nil {
			if out, runErr := exec.Command(bin, "--create", t.Path).CombinedOutput(); runErr != nil {
				return fmt.Errorf("systemd-tmpfiles --create: %s: %w", strings.TrimSpace(string(out)), runErr)
			}
		}
	}
	return nil
}
