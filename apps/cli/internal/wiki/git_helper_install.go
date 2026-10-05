package wiki

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// InstallGitRemoteHelper places the Git-discoverable helper beside the gdg
// executable. Git resolves git-remote-gdg-wiki through PATH, so the directory
// containing gdg must already be on PATH (as it normally is after install).
// It never overwrites another program's helper.
func InstallGitRemoteHelper(executable string) (string, error) {
	if executable == "" {
		var err error
		executable, err = os.Executable()
		if err != nil {
			return "", err
		}
	}
	executable, err := filepath.Abs(executable)
	if err != nil {
		return "", err
	}
	resolvedExecutable, err := filepath.EvalSymlinks(executable)
	if err == nil {
		executable = resolvedExecutable
	}
	helper := filepath.Join(filepath.Dir(executable), "git-remote-gdg-wiki")
	info, err := os.Lstat(helper)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			target, targetErr := filepath.EvalSymlinks(helper)
			if targetErr == nil && target == executable {
				return helper, nil
			}
		}
		return "", fmt.Errorf("refusing to replace existing Git helper %s", helper)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err = os.Symlink(executable, helper); err != nil {
		return "", fmt.Errorf("install Git helper: %w", err)
	}
	return helper, nil
}
