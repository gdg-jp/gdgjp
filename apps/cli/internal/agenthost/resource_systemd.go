package agenthost

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
)

// SystemdUnitResource manages systemd user/system service, timer, and drop-in units.
type SystemdUnitResource struct {
	UnitName       string
	Path           string
	Data           []byte
	Mode           os.FileMode
	Owner          string
	Group          string
	Scope          string // "user" or "system"
	User           string // e.g. "gdgagent-svc"
	Enable         bool
	ConditionStart func() bool
	Prefix         string
}

func (s *SystemdUnitResource) ID() string {
	return s.UnitName
}

func (s *SystemdUnitResource) ResourceType() string {
	return "systemd"
}

func (s *SystemdUnitResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   s.ID(),
		ResourceType: s.ResourceType(),
		Action:       ActionNone,
	}

	existing, err := os.ReadFile(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			ch.Action = ActionCreate
			ch.Diff = fmt.Sprintf("+ (create unit %s at %s)", s.UnitName, s.Path)
			return ch, nil
		}
		return ch, err
	}

	info, err := os.Stat(s.Path)
	if err != nil {
		return ch, err
	}

	modeDiff := false
	if s.Mode != 0 && (info.Mode()&0o777) != (s.Mode&0o777) {
		modeDiff = true
	}

	dataDiff := !bytes.Equal(existing, s.Data)

	ownerDiff := false
	if s.Prefix == "" && (s.Owner != "" || s.Group != "") && os.Getuid() == 0 {
		if uid, gid, ok := fileOwnerIDs(info); ok {
			wantUID, wantGID, lookupErr := lookupIDs(s.Owner, s.Group)
			if lookupErr == nil {
				if s.Owner != "" && uid != wantUID {
					ownerDiff = true
				}
				if s.Group != "" && gid != wantGID {
					ownerDiff = true
				}
			}
		}
	}

	if dataDiff || modeDiff || ownerDiff {
		ch.Action = ActionUpdate
		var diffs []string
		if dataDiff {
			diffs = append(diffs, fmt.Sprintf("~ content changed (%d -> %d bytes)", len(existing), len(s.Data)))
		}
		if modeDiff {
			diffs = append(diffs, fmt.Sprintf("~ mode 0%o -> 0%o", info.Mode()&0o777, s.Mode&0o777))
		}
		if ownerDiff {
			diffs = append(diffs, fmt.Sprintf("~ ownership -> %s:%s", s.Owner, s.Group))
		}
		ch.Diff = strings.Join(diffs, "\n")
		return ch, nil
	}

	// For live host, check enable/active state
	if s.Prefix == "" && os.Getuid() == 0 && s.Scope == "user" && s.User != "" {
		if s.Enable && !isUserUnitEnabled(s.User, s.UnitName) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("~ enable unit %s", s.UnitName)
			return ch, nil
		}
		if s.ConditionStart != nil && s.ConditionStart() {
			if !isUserUnitActive(s.User, s.UnitName) {
				ch.Action = ActionUpdate
				ch.Diff = fmt.Sprintf("~ start unit %s", s.UnitName)
				return ch, nil
			}
		}
	}

	if s.Prefix == "" && os.Getuid() == 0 && s.Scope == "system" {
		if s.Enable && !isSystemUnitEnabled(s.UnitName) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("~ enable unit %s", s.UnitName)
			return ch, nil
		}
		if s.ConditionStart != nil && s.ConditionStart() && !isSystemUnitActive(s.UnitName) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("~ start unit %s", s.UnitName)
			return ch, nil
		}
	}

	return ch, nil
}

func (s *SystemdUnitResource) Apply(ctx context.Context, c Change) error {
	dir := filepath.Dir(s.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	mode := s.Mode
	if mode == 0 {
		mode = 0o644
	}

	tmpFile := fmt.Sprintf("%s.tmp.%d", s.Path, os.Getpid())
	if err := os.WriteFile(tmpFile, s.Data, mode); err != nil {
		return fmt.Errorf("failed to write temporary file %s: %w", tmpFile, err)
	}
	defer os.Remove(tmpFile)

	if err := os.Chmod(tmpFile, mode); err != nil {
		return fmt.Errorf("failed to chmod %s: %w", tmpFile, err)
	}

	if s.Prefix == "" && (s.Owner != "" || s.Group != "") && os.Getuid() == 0 {
		_ = chownPath(tmpFile, s.Owner, s.Group)
		_ = chownPath(dir, s.Owner, s.Group)
	}

	// Preserve old file content for rollback if systemd handlers fail
	oldBackup := fmt.Sprintf("%s.bak.%d", s.Path, os.Getpid())
	hasOld := false
	if _, err := os.Stat(s.Path); err == nil {
		hasOld = true
		if err := os.Rename(s.Path, oldBackup); err != nil {
			return fmt.Errorf("failed to backup existing unit file %s: %w", s.Path, err)
		}
		defer os.Remove(oldBackup)
	}

	if err := os.Rename(tmpFile, s.Path); err != nil {
		if hasOld {
			_ = os.Rename(oldBackup, s.Path)
		}
		return fmt.Errorf("failed to rename %s to %s: %w", tmpFile, s.Path, err)
	}

	var reloaded bool
	rollback := func() error {
		var rbErrs []string
		_ = os.Remove(s.Path)
		if hasOld {
			if err := os.Rename(oldBackup, s.Path); err != nil {
				rbErrs = append(rbErrs, fmt.Sprintf("failed to restore %s: %v", s.Path, err))
			}
		}
		if reloaded && isSystemdRunning() {
			var rlErr error
			if s.Scope == "system" {
				rlErr = runSystemctl(context.Background(), "daemon-reload")
			} else {
				rlErr = runAsUser(s.User, "systemctl", "--user", "daemon-reload")
			}
			if rlErr != nil {
				rbErrs = append(rbErrs, fmt.Sprintf("systemctl daemon-reload during rollback failed: %v", rlErr))
			}
		}
		if len(rbErrs) > 0 {
			return fmt.Errorf("rollback failure: %s", strings.Join(rbErrs, "; "))
		}
		return nil
	}

	if s.Prefix == "" && os.Getuid() == 0 && s.Scope == "user" && s.User != "" && isSystemdRunning() {
		if out, err := exec.CommandContext(ctx, "loginctl", "enable-linger", s.User).CombinedOutput(); err != nil {
			if rbErr := rollback(); rbErr != nil {
				return fmt.Errorf("loginctl enable-linger %s failed: %w (%s); %v", s.User, err, strings.TrimSpace(string(out)), rbErr)
			}
			return fmt.Errorf("loginctl enable-linger %s failed: %w (%s)", s.User, err, strings.TrimSpace(string(out)))
		}

		if err := runAsUser(s.User, "systemctl", "--user", "daemon-reload"); err != nil {
			if rbErr := rollback(); rbErr != nil {
				return fmt.Errorf("systemctl --user daemon-reload failed: %w; %v", err, rbErr)
			}
			return fmt.Errorf("systemctl --user daemon-reload failed: %w", err)
		}
		reloaded = true

		if s.Enable {
			if err := runAsUser(s.User, "systemctl", "--user", "enable", s.UnitName); err != nil {
				if rbErr := rollback(); rbErr != nil {
					return fmt.Errorf("systemctl --user enable %s failed: %w; %v", s.UnitName, err, rbErr)
				}
				return fmt.Errorf("systemctl --user enable %s failed: %w", s.UnitName, err)
			}
		}

		if s.ConditionStart != nil {
			if s.ConditionStart() {
				action := "start"
				if isUserUnitActive(s.User, s.UnitName) {
					action = "restart"
				}
				if err := runAsUser(s.User, "systemctl", "--user", action, s.UnitName); err != nil {
					if rbErr := rollback(); rbErr != nil {
						return fmt.Errorf("systemctl --user %s %s failed: %w; %v", action, s.UnitName, err, rbErr)
					}
					return fmt.Errorf("systemctl --user %s %s failed: %w", action, s.UnitName, err)
				}
			} else {
				fmt.Printf("notice: skipping %s start (secrets not configured)\n", s.UnitName)
			}
		}
	}

	if s.Prefix == "" && os.Getuid() == 0 && s.Scope == "system" && isSystemdRunning() {
		if err := runSystemctl(ctx, "daemon-reload"); err != nil {
			if rbErr := rollback(); rbErr != nil {
				return fmt.Errorf("%w; %v", err, rbErr)
			}
			return err
		}
		reloaded = true

		if s.Enable {
			if err := runSystemctl(ctx, "enable", s.UnitName); err != nil {
				if rbErr := rollback(); rbErr != nil {
					return fmt.Errorf("%w; %v", err, rbErr)
				}
				return err
			}
		}

		if s.ConditionStart != nil {
			if s.ConditionStart() {
				action := "start"
				if isSystemUnitActive(s.UnitName) {
					action = "restart"
				}
				if err := runSystemctl(ctx, action, s.UnitName); err != nil {
					if rbErr := rollback(); rbErr != nil {
						return fmt.Errorf("%w; %v", err, rbErr)
					}
					return err
				}
			} else {
				fmt.Printf("notice: skipping %s start (dependencies not yet installed)\n", s.UnitName)
			}
		}
	}

	return nil
}

// runSystemctl runs the system (PID 1) systemctl, surfacing its output on failure.
func runSystemctl(ctx context.Context, args ...string) error {
	out, err := exec.CommandContext(ctx, "systemctl", args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl %s failed: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return nil
}

func isSystemUnitEnabled(unit string) bool {
	return exec.Command("systemctl", "is-enabled", "--quiet", unit).Run() == nil
}

func isSystemUnitActive(unit string) bool {
	return exec.Command("systemctl", "is-active", "--quiet", unit).Run() == nil
}

// SystemdUnitDeleteResource stops, disables, and removes a managed unit. It is
// the systemd sibling of FileDeleteResource: used when a spec section that owned
// a unit is turned off.
type SystemdUnitDeleteResource struct {
	UnitName string
	Path     string
	Scope    string // "user" or "system"
	User     string
	Prefix   string
}

func (s *SystemdUnitDeleteResource) ID() string { return s.UnitName }

func (s *SystemdUnitDeleteResource) ResourceType() string { return "systemd" }

func (s *SystemdUnitDeleteResource) live() bool {
	if s.Prefix != "" || os.Getuid() != 0 {
		return false
	}
	return s.Scope == "system" || (s.Scope == "user" && s.User != "")
}

func (s *SystemdUnitDeleteResource) isActiveOrEnabled() bool {
	if s.Scope == "system" {
		return isSystemUnitActive(s.UnitName) || isSystemUnitEnabled(s.UnitName)
	}
	return isUserUnitActive(s.User, s.UnitName) || isUserUnitEnabled(s.User, s.UnitName)
}

func (s *SystemdUnitDeleteResource) systemctl(ctx context.Context, args ...string) error {
	if s.Scope == "system" {
		return runSystemctl(ctx, args...)
	}
	return runAsUser(s.User, "systemctl", append([]string{"--user"}, args...)...)
}

func (s *SystemdUnitDeleteResource) Plan(_ context.Context) (Change, error) {
	ch := Change{ResourceID: s.ID(), ResourceType: s.ResourceType(), Action: ActionNone}

	if _, err := os.Stat(s.Path); err == nil {
		ch.Action = ActionDelete
		ch.Diff = fmt.Sprintf("- disable and remove unit %s (%s)", s.UnitName, s.Path)
		return ch, nil
	} else if !os.IsNotExist(err) {
		return ch, err
	}

	// Unit file already gone; still reconcile a lingering enabled/active state.
	if s.live() && s.isActiveOrEnabled() {
		ch.Action = ActionDelete
		ch.Diff = fmt.Sprintf("- stop and disable unit %s", s.UnitName)
	}
	return ch, nil
}

func (s *SystemdUnitDeleteResource) Apply(ctx context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	if s.live() && isSystemdRunning() {
		if err := s.systemctl(ctx, "disable", "--now", s.UnitName); err != nil && !isMissingUnitError(err) {
			return fmt.Errorf("disabling %s failed: %w", s.UnitName, err)
		}
	}
	if err := os.Remove(s.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	if s.live() && isSystemdRunning() {
		if err := s.systemctl(ctx, "daemon-reload"); err != nil {
			return fmt.Errorf("systemctl daemon-reload after removing %s failed: %w", s.UnitName, err)
		}
	}
	return nil
}

// isMissingUnitError reports whether a systemctl failure is only "the unit is
// already gone" (safe to ignore during teardown) rather than a real failure.
func isMissingUnitError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, marker := range []string{
		"does not exist",
		"not loaded",
		"No such file",
		"not found",
	} {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

func runAsUser(username string, command string, args ...string) error {
	if _, err := exec.LookPath("runuser"); err != nil {
		return nil
	}
	u, err := user.Lookup(username)
	if err != nil {
		return fmt.Errorf("user lookup %s: %w", username, err)
	}
	runtimeDir := fmt.Sprintf("/run/user/%s", u.Uid)
	cmdArgs := append([]string{"-u", username, "--", "env",
		"HOME=" + u.HomeDir,
		"USER=" + username,
		"LOGNAME=" + username,
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"TMPDIR=/tmp",
		"XDG_CONFIG_HOME=" + filepath.Join(u.HomeDir, ".config"),
		"XDG_DATA_HOME=" + filepath.Join(u.HomeDir, ".local/share"),
		"XDG_RUNTIME_DIR=" + runtimeDir,
		command,
	}, args...)
	c := exec.Command("runuser", cmdArgs...)
	c.Dir = u.HomeDir
	out, err := c.CombinedOutput()
	if err != nil {
		return fmt.Errorf("runuser -u %s %s failed: %w (output: %s)", username, command, err, string(out))
	}
	return nil
}

func isUserUnitActive(username, unit string) bool {
	if _, err := exec.LookPath("runuser"); err != nil {
		return false
	}
	u, err := user.Lookup(username)
	if err != nil {
		return false
	}
	runtimeDir := fmt.Sprintf("/run/user/%s", u.Uid)
	c := exec.Command("runuser", "-u", username, "--", "env",
		"HOME="+u.HomeDir,
		"XDG_RUNTIME_DIR="+runtimeDir,
		"systemctl", "--user", "is-active", "--quiet", unit)
	return c.Run() == nil
}

func isUserUnitEnabled(username, unit string) bool {
	if _, err := exec.LookPath("runuser"); err != nil {
		return false
	}
	u, err := user.Lookup(username)
	if err != nil {
		return false
	}
	runtimeDir := fmt.Sprintf("/run/user/%s", u.Uid)
	c := exec.Command("runuser", "-u", username, "--", "env",
		"HOME="+u.HomeDir,
		"XDG_RUNTIME_DIR="+runtimeDir,
		"systemctl", "--user", "is-enabled", "--quiet", unit)
	return c.Run() == nil
}

func isSystemdRunning() bool {
	info, err := os.Stat("/run/systemd/system")
	return err == nil && info.IsDir()
}
