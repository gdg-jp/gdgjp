package agenthost

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// DirResource manages directory existence, permissions, and ownership.
type DirResource struct {
	Path           string
	Mode           os.FileMode
	Owner          string
	Group          string
	RecursiveChown bool
	RecursiveChmod bool
}

func (d *DirResource) ID() string {
	return d.Path
}

func (d *DirResource) ResourceType() string {
	return "dir"
}

func (d *DirResource) Plan(_ context.Context) (Change, error) {
	info, err := os.Lstat(d.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   d.Path,
				ResourceType: d.ResourceType(),
				Action:       ActionCreate,
				Diff:         fmt.Sprintf("+ dir %s (mode %s)", d.Path, sprintf04o(uint32(d.Mode))),
			}, nil
		}
		return Change{}, err
	}

	var diffs []string
	action := ActionNone

	if !info.IsDir() {
		return Change{
			ResourceID:   d.Path,
			ResourceType: d.ResourceType(),
			Action:       ActionUpdate,
			Diff:         fmt.Sprintf("replace non-directory %s with directory", d.Path),
		}, nil
	}

	currentMode := unixFileModeFromInfo(info)
	if currentMode != d.Mode {
		action = ActionUpdate
		diffs = append(diffs, fmt.Sprintf("~ mode %s -> %s", sprintf04o(uint32(currentMode)), sprintf04o(uint32(d.Mode))))
	}

	if (d.Owner != "" || d.Group != "") && os.Getuid() == 0 {
		if uid, gid, ok := fileOwnerIDs(info); ok {
			wantUID, wantGID, lookupErr := lookupIDs(d.Owner, d.Group)
			if lookupErr == nil {
				if d.Owner != "" && uid != wantUID {
					action = ActionUpdate
					diffs = append(diffs, fmt.Sprintf("~ owner uid %d -> %s(%d)", uid, d.Owner, wantUID))
				}
				if d.Group != "" && gid != wantGID {
					action = ActionUpdate
					diffs = append(diffs, fmt.Sprintf("~ group gid %d -> %s(%d)", gid, d.Group, wantGID))
				}
			}
		}
	}

	diffText := ""
	if len(diffs) > 0 {
		diffText = fmt.Sprintf("~ dir %s:\n    %s", d.Path, joinDiffs(diffs))
	}

	return Change{
		ResourceID:   d.Path,
		ResourceType: d.ResourceType(),
		Action:       action,
		Diff:         diffText,
	}, nil
}

func (d *DirResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}

	// Safely verify existing entry at d.Path using Lstat (does not follow symlinks)
	if info, err := os.Lstat(d.Path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			if err := os.Remove(d.Path); err != nil {
				return fmt.Errorf("failed to unlink non-directory/symlink at %s: %w", d.Path, err)
			}
		}
	}

	if err := os.MkdirAll(filepath.Dir(d.Path), 0o755); err != nil {
		return err
	}
	if err := os.Mkdir(d.Path, d.Mode); err != nil && !os.IsExist(err) {
		return err
	}

	// Positively confirm d.Path is a genuine directory and NOT a symlink
	info, err := os.Lstat(d.Path)
	if err != nil {
		return fmt.Errorf("failed to stat created directory %s: %w", d.Path, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("expected %s to be a directory, but found symlink/file", d.Path)
	}

	if err := os.Chmod(d.Path, d.Mode); err != nil {
		return err
	}
	if (d.Owner != "" || d.Group != "") && os.Getuid() == 0 {
		if d.RecursiveChown {
			if err := chownRecursive(d.Path, d.Owner, d.Group); err != nil {
				return err
			}
		} else {
			if err := chownPath(d.Path, d.Owner, d.Group); err != nil {
				return err
			}
		}
	}
	if d.RecursiveChmod {
		_ = filepath.Walk(d.Path, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return os.Chmod(path, d.Mode)
			}
			return nil
		})
	}
	return nil
}

// DirDeleteResource manages the removal of obsolete directories.
type DirDeleteResource struct {
	Path string
}

func (d *DirDeleteResource) ID() string {
	return d.Path
}

func (d *DirDeleteResource) ResourceType() string {
	return "dir"
}

func (d *DirDeleteResource) Plan(_ context.Context) (Change, error) {
	if _, err := os.Lstat(d.Path); err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   d.Path,
				ResourceType: d.ResourceType(),
				Action:       ActionNone,
			}, nil
		}
		return Change{}, err
	}
	return Change{
		ResourceID:   d.Path,
		ResourceType: d.ResourceType(),
		Action:       ActionDelete,
		Diff:         fmt.Sprintf("- obsolete directory %s", d.Path),
	}, nil
}

func (d *DirDeleteResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	if err := os.RemoveAll(d.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
