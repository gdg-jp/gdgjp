package agenthost

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// FileResource manages a file with specific contents, mode, and ownership.
type FileResource struct {
	Path                 string
	Data                 []byte
	Mode                 os.FileMode
	Owner                string
	Group                string
	testBeforeRenameHook func() error
}

func (f *FileResource) ID() string {
	return f.Path
}

func (f *FileResource) ResourceType() string {
	return "file"
}

func (f *FileResource) Plan(_ context.Context) (Change, error) {
	info, err := os.Lstat(f.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   f.Path,
				ResourceType: f.ResourceType(),
				Action:       ActionCreate,
				Diff:         fmt.Sprintf("+ file %s (mode %s)", f.Path, sprintf04o(uint32(f.Mode))),
			}, nil
		}
		return Change{}, err
	}

	var diffs []string
	action := ActionNone

	if info.Mode().IsDir() || info.Mode()&os.ModeSymlink != 0 {
		diffs = append(diffs, fmt.Sprintf("replace non-file with regular file (mode %s)", sprintf04o(uint32(f.Mode))))
		action = ActionUpdate
	} else {
		existing, readErr := os.ReadFile(f.Path)
		if readErr != nil {
			return Change{}, readErr
		}
		if !bytes.Equal(existing, f.Data) {
			action = ActionUpdate
			diffs = append(diffs, fmt.Sprintf("~ content (%d bytes -> %d bytes)", len(existing), len(f.Data)))
		}

		currentMode := unixFileModeFromInfo(info)
		if currentMode != f.Mode {
			action = ActionUpdate
			diffs = append(diffs, fmt.Sprintf("~ mode %s -> %s", sprintf04o(uint32(currentMode)), sprintf04o(uint32(f.Mode))))
		}

		if (f.Owner != "" || f.Group != "") && os.Getuid() == 0 {
			if uid, gid, ok := fileOwnerIDs(info); ok {
				wantUID, wantGID, lookupErr := lookupIDs(f.Owner, f.Group)
				if lookupErr == nil {
					if f.Owner != "" && uid != wantUID {
						action = ActionUpdate
						diffs = append(diffs, fmt.Sprintf("~ owner uid %d -> %s(%d)", uid, f.Owner, wantUID))
					}
					if f.Group != "" && gid != wantGID {
						action = ActionUpdate
						diffs = append(diffs, fmt.Sprintf("~ group gid %d -> %s(%d)", gid, f.Group, wantGID))
					}
				}
			}
		}
	}

	diffText := ""
	if len(diffs) > 0 {
		diffText = fmt.Sprintf("~ file %s:\n    %s", f.Path, joinDiffs(diffs))
	}

	return Change{
		ResourceID:   f.Path,
		ResourceType: f.ResourceType(),
		Action:       action,
		Diff:         diffText,
	}, nil
}

func (f *FileResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(f.Path), 0o755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(f.Path), ".tmp-")
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

	if _, err := tmp.Write(f.Data); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, f.Mode); err != nil {
		return err
	}
	if (f.Owner != "" || f.Group != "") && os.Getuid() == 0 {
		if err := chownPath(tmpName, f.Owner, f.Group); err != nil {
			return err
		}
	}
	if f.testBeforeRenameHook != nil {
		if err := f.testBeforeRenameHook(); err != nil {
			return err
		}
	}
	if err := os.Rename(tmpName, f.Path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

func unixFileModeFromInfo(info os.FileInfo) os.FileMode {
	mode := info.Mode().Perm()
	if info.Mode()&os.ModeSticky != 0 {
		mode |= os.ModeSticky
	}
	if info.Mode()&os.ModeSetgid != 0 {
		mode |= os.ModeSetgid
	}
	if info.Mode()&os.ModeSetuid != 0 {
		mode |= os.ModeSetuid
	}
	return mode
}

func joinDiffs(diffs []string) string {
	var b string
	for i, d := range diffs {
		if i > 0 {
			b += "\n    "
		}
		b += d
	}
	return b
}

// FileDeleteResource manages the removal of undeclared files.
type FileDeleteResource struct {
	Path string
}

func (f *FileDeleteResource) ID() string {
	return f.Path
}

func (f *FileDeleteResource) ResourceType() string {
	return "file"
}

func (f *FileDeleteResource) Plan(_ context.Context) (Change, error) {
	if _, err := os.Lstat(f.Path); err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   f.Path,
				ResourceType: f.ResourceType(),
				Action:       ActionNone,
			}, nil
		}
		return Change{}, err
	}
	return Change{
		ResourceID:   f.Path,
		ResourceType: f.ResourceType(),
		Action:       ActionDelete,
		Diff:         fmt.Sprintf("- undeclared file %s", f.Path),
	}, nil
}

func (f *FileDeleteResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	if err := os.Remove(f.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
