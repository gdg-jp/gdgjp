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

// SudoersResource validates sudoers content with visudo before atomic placement.
type SudoersResource struct {
	Path string
	Data []byte
}

func (s *SudoersResource) ID() string {
	return s.Path
}

func (s *SudoersResource) ResourceType() string {
	return "sudoers"
}

func (s *SudoersResource) Plan(_ context.Context) (Change, error) {
	info, err := os.Lstat(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   s.Path,
				ResourceType: s.ResourceType(),
				Action:       ActionCreate,
				Diff:         fmt.Sprintf("+ sudoers %s (mode 0440)", s.Path),
			}, nil
		}
		return Change{}, err
	}

	existing, err := os.ReadFile(s.Path)
	if err != nil {
		return Change{}, err
	}

	action := ActionNone
	var diffs []string
	if !bytes.Equal(existing, s.Data) {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ content (%d bytes -> %d bytes)", len(existing), len(s.Data)))
	}
	currentMode := info.Mode().Perm()
	if currentMode != 0o440 {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ mode %04o -> 0440", currentMode))
	}

	diffText := ""
	if len(diffs) > 0 {
		diffText = fmt.Sprintf("~ sudoers %s:\n    %s", s.Path, joinDiffs(diffs))
	}

	return Change{
		ResourceID:   s.Path,
		ResourceType: s.ResourceType(),
		Action:       action,
		Diff:         diffText,
	}, nil
}

func (s *SudoersResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	dir := filepath.Dir(s.Path)
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

	if _, err := tmp.Write(s.Data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	visudo := lookVisudo()
	if visudo == "" {
		return fmt.Errorf("visudo is required to validate sudoers file before replacement")
	}
	cmd := exec.Command(visudo, "-cf", tmpName)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("visudo validation failed for generated sudoers file: %s", strings.TrimSpace(string(out)))
	}
	if err := os.Chmod(tmpName, 0o440); err != nil {
		return err
	}
	if err := os.Rename(tmpName, s.Path); err != nil {
		return err
	}
	cleanup = false
	return nil
}
