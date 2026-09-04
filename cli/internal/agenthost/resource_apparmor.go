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

// AppArmorResource manages an AppArmor profile file and reloads it on change.
type AppArmorResource struct {
	Path   string
	Data   []byte
	Prefix string
}

func (a *AppArmorResource) ID() string {
	return a.Path
}

func (a *AppArmorResource) ResourceType() string {
	return "apparmor"
}

func (a *AppArmorResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   a.ID(),
		ResourceType: a.ResourceType(),
		Action:       ActionNone,
	}

	existing, err := os.ReadFile(a.Path)
	if err != nil {
		if os.IsNotExist(err) {
			ch.Action = ActionCreate
			ch.Diff = fmt.Sprintf("+ (create AppArmor profile %s)", a.Path)
			return ch, nil
		}
		return ch, err
	}

	if !bytes.Equal(existing, a.Data) {
		ch.Action = ActionUpdate
		ch.Diff = fmt.Sprintf("~ AppArmor profile content changed (%d -> %d bytes)", len(existing), len(a.Data))
		return ch, nil
	}

	return ch, nil
}

func (a *AppArmorResource) Apply(ctx context.Context, c Change) error {
	dir := filepath.Dir(a.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	tmpFile := fmt.Sprintf("%s.tmp.%d", a.Path, os.Getpid())
	if err := os.WriteFile(tmpFile, a.Data, 0o644); err != nil {
		return fmt.Errorf("failed to write temporary file %s: %w", tmpFile, err)
	}
	defer os.Remove(tmpFile)

	if err := os.Chmod(tmpFile, 0o644); err != nil {
		return fmt.Errorf("failed to chmod %s: %w", tmpFile, err)
	}

	if a.Prefix == "" && os.Getuid() == 0 {
		_ = chownPath(tmpFile, "root", "root")

		// If AppArmor is enabled on the host, validate and reload profile from tmpFile before committing
		if _, statErr := os.Stat("/sys/kernel/security/apparmor"); statErr == nil {
			parserPath, err := exec.LookPath("apparmor_parser")
			if err != nil {
				return fmt.Errorf("AppArmor is active on host but apparmor_parser was not found in PATH: %w", err)
			}
			cmd := exec.CommandContext(ctx, parserPath, "-q", "-r", tmpFile)
			out, err := cmd.CombinedOutput()
			if err != nil {
				// Do NOT commit tmpFile to a.Path; preserve retryability on next apply
				return fmt.Errorf("failed to load AppArmor profile %s: %w (%s)", a.Path, err, strings.TrimSpace(string(out)))
			}
		}
	}

	if err := os.Rename(tmpFile, a.Path); err != nil {
		return fmt.Errorf("failed to rename %s to %s: %w", tmpFile, a.Path, err)
	}

	return nil
}
