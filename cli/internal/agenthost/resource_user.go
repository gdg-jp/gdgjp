package agenthost

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

// GroupResource manages a system group.
type GroupResource struct {
	Name   string
	System bool
	Prefix string
}

func (g *GroupResource) ID() string {
	return "group:" + g.Name
}

func (g *GroupResource) ResourceType() string {
	return "group"
}

func (g *GroupResource) Plan(_ context.Context) (Change, error) {
	if g.Prefix != "" || os.Getuid() != 0 {
		return Change{
			ResourceID:   g.ID(),
			ResourceType: g.ResourceType(),
			Action:       ActionNone,
		}, nil
	}

	_, err := user.LookupGroup(g.Name)
	if err != nil {
		return Change{
			ResourceID:   g.ID(),
			ResourceType: g.ResourceType(),
			Action:       ActionCreate,
			Diff:         fmt.Sprintf("+ group %s (system: %v)", g.Name, g.System),
		}, nil
	}

	return Change{
		ResourceID:   g.ID(),
		ResourceType: g.ResourceType(),
		Action:       ActionNone,
	}, nil
}

func (g *GroupResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone || g.Prefix != "" || os.Getuid() != 0 {
		return nil
	}
	args := []string{}
	if g.System {
		args = append(args, "--system")
	}
	args = append(args, g.Name)
	cmd := exec.Command("groupadd", args...)
	if out, err := cmd.CombinedOutput(); err != nil {
		// If group already exists, treat as success
		if _, lookupErr := user.LookupGroup(g.Name); lookupErr == nil {
			return nil
		}
		return fmt.Errorf("groupadd %s failed: %s: %w", g.Name, strings.TrimSpace(string(out)), err)
	}
	return nil
}

// UserResource manages a system user with home directory and groups.
type UserResource struct {
	Name         string
	System       bool
	Home         string
	Shell        string
	PrimaryGroup string
	Groups       []string
	Prefix       string
}

func (u *UserResource) ID() string {
	return "user:" + u.Name
}

func (u *UserResource) ResourceType() string {
	return "user"
}

func (u *UserResource) Plan(_ context.Context) (Change, error) {
	if u.Prefix != "" || os.Getuid() != 0 {
		return Change{
			ResourceID:   u.ID(),
			ResourceType: u.ResourceType(),
			Action:       ActionNone,
		}, nil
	}

	existingUser, err := user.Lookup(u.Name)
	if err != nil {
		return Change{
			ResourceID:   u.ID(),
			ResourceType: u.ResourceType(),
			Action:       ActionCreate,
			Diff:         fmt.Sprintf("+ user %s (home: %s, gid: %s, groups: %s)", u.Name, u.Home, u.PrimaryGroup, strings.Join(u.Groups, ",")),
		}, nil
	}

	var diffs []string
	action := ActionNone

	primaryGrp, err := user.LookupGroupId(existingUser.Gid)
	if err == nil && primaryGrp.Name != u.PrimaryGroup {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ primary group %s -> %s", primaryGrp.Name, u.PrimaryGroup))
	}

	if existingUser.HomeDir != u.Home {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ home dir %s -> %s", existingUser.HomeDir, u.Home))
	}

	if u.Shell != "" {
		if curShell, err := lookupUserShell(u.Name); err == nil && curShell != u.Shell {
			action = ActionUpdate
			diffs = append(diffs, fmt.Sprintf("~ shell %s -> %s", curShell, u.Shell))
		}
	}

	groupIDs, err := existingUser.GroupIds()
	if err == nil {
		groupNameSet := make(map[string]bool)
		for _, gid := range groupIDs {
			if g, gErr := user.LookupGroupId(gid); gErr == nil {
				groupNameSet[g.Name] = true
			}
		}
		for _, wantGrp := range u.Groups {
			if !groupNameSet[wantGrp] {
				action = ActionUpdate
				diffs = append(diffs, fmt.Sprintf("~ add to supplementary group %s", wantGrp))
			}
		}
	}

	diffText := ""
	if len(diffs) > 0 {
		diffText = fmt.Sprintf("~ user %s:\n    %s", u.Name, joinDiffs(diffs))
	}

	return Change{
		ResourceID:   u.ID(),
		ResourceType: u.ResourceType(),
		Action:       action,
		Diff:         diffText,
	}, nil
}

func (u *UserResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone || u.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	if c.Action == ActionCreate {
		args := []string{}
		if u.System {
			args = append(args, "--system")
		}
		args = append(args, "--create-home", "--home-dir", u.Home, "--gid", u.PrimaryGroup)
		if len(u.Groups) > 0 {
			args = append(args, "--groups", strings.Join(u.Groups, ","))
		}
		if u.Shell != "" {
			args = append(args, "--shell", u.Shell)
		}
		args = append(args, u.Name)
		cmd := exec.Command("useradd", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			if _, lookupErr := user.Lookup(u.Name); lookupErr == nil {
				return nil
			}
			return fmt.Errorf("useradd %s failed: %s: %w", u.Name, strings.TrimSpace(string(out)), err)
		}
		return nil
	}

	if c.Action == ActionUpdate {
		args := []string{"-g", u.PrimaryGroup}
		if u.Home != "" {
			args = append(args, "-d", u.Home)
		}
		if u.Shell != "" {
			args = append(args, "-s", u.Shell)
		}
		if len(u.Groups) > 0 {
			args = append(args, "-aG", strings.Join(u.Groups, ","))
		}
		args = append(args, u.Name)
		cmd := exec.Command("usermod", args...)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("usermod %s failed: %s: %w", u.Name, strings.TrimSpace(string(out)), err)
		}
	}
	return nil
}

func lookupUserShell(username string) (string, error) {
	if getentPath, err := exec.LookPath("getent"); err == nil {
		out, err := exec.Command(getentPath, "passwd", username).Output()
		if err == nil {
			fields := strings.Split(strings.TrimSpace(string(out)), ":")
			if len(fields) >= 7 {
				return fields[6], nil
			}
		}
	}
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) >= 7 && fields[0] == username {
			return fields[6], nil
		}
	}
	return "", fmt.Errorf("user %s not found in /etc/passwd", username)
}

// PruneSlotResource deletes decommissioned slot users, home directories, and run directories.
type PruneSlotResource struct {
	Slot  int
	Paths layoutPaths
}

func (p *PruneSlotResource) ID() string {
	return fmt.Sprintf("prune-slot:%d", p.Slot)
}

func (p *PruneSlotResource) ResourceType() string {
	return "user"
}

func (p *PruneSlotResource) Plan(_ context.Context) (Change, error) {
	userName := fmt.Sprintf("gdgagent-run-%d", p.Slot)
	runSlotDir := filepath.Join(p.Paths.RunRoot, strconv.Itoa(p.Slot))
	homeDir := filepath.Join(p.Paths.HomeRoot, userName)

	var targets []string
	if _, err := os.Lstat(runSlotDir); err == nil {
		targets = append(targets, runSlotDir)
	}
	if _, err := os.Lstat(homeDir); err == nil {
		targets = append(targets, homeDir)
	}
	if p.Paths.Prefix == "" && os.Getuid() == 0 {
		if _, err := user.Lookup(userName); err == nil {
			targets = append(targets, "user "+userName)
		}
		if _, err := user.LookupGroup(userName); err == nil {
			targets = append(targets, "group "+userName)
		}
	}

	if len(targets) == 0 {
		return Change{
			ResourceID:   p.ID(),
			ResourceType: p.ResourceType(),
			Action:       ActionNone,
		}, nil
	}

	return Change{
		ResourceID:   p.ID(),
		ResourceType: p.ResourceType(),
		Action:       ActionDelete,
		Diff:         fmt.Sprintf("- prune decommissioned slot %d:\n    %s", p.Slot, joinDiffs(targets)),
	}, nil
}

func (p *PruneSlotResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}

	userName := fmt.Sprintf("gdgagent-run-%d", p.Slot)
	runSlotDir := filepath.Join(p.Paths.RunRoot, strconv.Itoa(p.Slot))
	homeDir := filepath.Join(p.Paths.HomeRoot, userName)

	// Live check: fail closed if processes are running or if check cannot positively confirm zero processes
	if p.Paths.Prefix == "" && os.Getuid() == 0 {
		pgrepPath, err := exec.LookPath("pgrep")
		if err != nil {
			return fmt.Errorf("cannot prune slot %d: pgrep is required to verify no active processes for user %s: %w", p.Slot, userName, err)
		}
		out, runErr := exec.Command(pgrepPath, "-u", userName).CombinedOutput()
		if runErr == nil {
			return fmt.Errorf("cannot prune slot %d: active processes detected for user %s (PID: %s)", p.Slot, userName, strings.TrimSpace(string(out)))
		}
		var exitErr *exec.ExitError
		if errors.As(runErr, &exitErr) && exitErr.ExitCode() == 1 {
			// Exit code 1 positively confirms 0 processes matched.
		} else {
			return fmt.Errorf("cannot prune slot %d: failed to verify process status for user %s: %s: %w", p.Slot, userName, strings.TrimSpace(string(out)), runErr)
		}
	}

	// 1. Delete /run/gdg-agent/N
	if err := os.RemoveAll(runSlotDir); err != nil && !os.IsNotExist(err) {
		return err
	}

	// 2. Delete /home/gdgagent-run-N (including .config/cursor/auth.json)
	if err := os.RemoveAll(homeDir); err != nil && !os.IsNotExist(err) {
		return err
	}

	// 3. userdel and groupdel
	if p.Paths.Prefix == "" && os.Getuid() == 0 {
		if _, err := user.Lookup(userName); err == nil {
			if out, delErr := exec.Command("userdel", userName).CombinedOutput(); delErr != nil {
				return fmt.Errorf("userdel %s failed: %s: %w", userName, strings.TrimSpace(string(out)), delErr)
			}
		}
		if _, err := user.LookupGroup(userName); err == nil {
			if out, delErr := exec.Command("groupdel", userName).CombinedOutput(); delErr != nil {
				return fmt.Errorf("groupdel %s failed: %s: %w", userName, strings.TrimSpace(string(out)), delErr)
			}
		}
	}

	return nil
}
