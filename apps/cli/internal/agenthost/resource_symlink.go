package agenthost

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// SymlinkResource manages symbolic links.
type SymlinkResource struct {
	Path   string
	Target string
}

func (s *SymlinkResource) ID() string {
	return s.Path
}

func (s *SymlinkResource) ResourceType() string {
	return "symlink"
}

func (s *SymlinkResource) Plan(_ context.Context) (Change, error) {
	info, err := os.Lstat(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return Change{
				ResourceID:   s.Path,
				ResourceType: s.ResourceType(),
				Action:       ActionCreate,
				Diff:         fmt.Sprintf("+ symlink %s -> %s", s.Path, s.Target),
			}, nil
		}
		return Change{}, err
	}

	if info.Mode()&os.ModeSymlink != 0 {
		curTarget, readErr := os.Readlink(s.Path)
		if readErr == nil && curTarget == s.Target {
			return Change{
				ResourceID:   s.Path,
				ResourceType: s.ResourceType(),
				Action:       ActionNone,
			}, nil
		}
		return Change{
			ResourceID:   s.Path,
			ResourceType: s.ResourceType(),
			Action:       ActionUpdate,
			Diff:         fmt.Sprintf("~ symlink %s: %s -> %s", s.Path, curTarget, s.Target),
		}, nil
	}

	return Change{
		ResourceID:   s.Path,
		ResourceType: s.ResourceType(),
		Action:       ActionUpdate,
		Diff:         fmt.Sprintf("replace non-symlink with symlink %s -> %s", s.Path, s.Target),
	}, nil
}

func (s *SymlinkResource) Apply(_ context.Context, c Change) error {
	if c.Action == ActionNone {
		return nil
	}
	dir := filepath.Dir(s.Path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(dir, fmt.Sprintf(".tmp-symlink-%d", os.Getpid()))
	_ = os.Remove(tmp)
	if err := os.Symlink(s.Target, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.Path); err != nil {
		_ = os.Remove(tmp)
		_ = os.Remove(s.Path)
		return os.Symlink(s.Target, s.Path)
	}
	return nil
}
