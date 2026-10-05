package agenthost

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ErrNoRollbackTarget is returned when a rollback is requested but no distinct previous release
// generation is available to roll back to. Callers must surface this loudly (non-zero exit,
// journal entry) rather than silently continuing -- see Stage 10's design constraints.
var ErrNoRollbackTarget = errors.New("no previous release generation available to roll back to")

func currentReleaseSymlinkPath(releasesRoot string) string {
	return filepath.Join(releasesRoot, "current")
}

// CurrentReleaseVersion returns the version currently pointed to by releasesRoot/current, or ""
// if no release has ever been successfully applied yet.
func CurrentReleaseVersion(releasesRoot string) (string, error) {
	target, err := os.Readlink(currentReleaseSymlinkPath(releasesRoot))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return filepath.Base(target), nil
}

// setCurrentRelease atomically repoints releasesRoot/current at version.
func setCurrentRelease(releasesRoot, version string) error {
	link := currentReleaseSymlinkPath(releasesRoot)
	tmp := fmt.Sprintf("%s.tmp-%d", link, os.Getpid())
	_ = os.Remove(tmp)
	if err := os.Symlink(version, tmp); err != nil {
		return err
	}
	if err := os.Rename(tmp, link); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// ListReleaseGenerations returns installed release version directories under releasesRoot,
// oldest first by directory modification time.
func ListReleaseGenerations(releasesRoot string) ([]string, error) {
	entries, err := os.ReadDir(releasesRoot)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var versions []string
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		versions = append(versions, e.Name())
	}
	sort.Slice(versions, func(i, j int) bool {
		iInfo, iErr := os.Stat(filepath.Join(releasesRoot, versions[i]))
		jInfo, jErr := os.Stat(filepath.Join(releasesRoot, versions[j]))
		if iErr != nil || jErr != nil {
			return versions[i] < versions[j]
		}
		return iInfo.ModTime().Before(jInfo.ModTime())
	})
	return versions, nil
}

// pruneReleaseGenerations removes the oldest installed generations beyond keep, always leaving
// the currently-active generation (and at least one generation overall) untouched.
func pruneReleaseGenerations(releasesRoot string, keep int) error {
	versions, err := ListReleaseGenerations(releasesRoot)
	if err != nil {
		return err
	}
	if keep < 1 {
		keep = 1
	}
	if len(versions) <= keep {
		return nil
	}
	current, err := CurrentReleaseVersion(releasesRoot)
	if err != nil {
		return err
	}
	toRemove := len(versions) - keep
	removed := 0
	for _, v := range versions {
		if removed >= toRemove {
			break
		}
		if v == current {
			continue
		}
		if err := os.RemoveAll(filepath.Join(releasesRoot, v)); err != nil {
			return err
		}
		removed++
	}
	return nil
}

// RollbackOptions controls a manual rollback to a previously-installed release generation.
type RollbackOptions struct {
	ReleasesRoot string
	Prefix       string
	To           string // explicit target version; if empty, rolls back to the generation immediately before current
	SlotCount    int
}

// Rollback re-applies a previously-installed release generation and updates the current pointer.
// It never contacts the network: it operates purely on generations already extracted under
// ReleasesRoot by a prior ApplyRelease call, so a rollback can never be blocked by the same
// connectivity or signing-key issue that might be causing the incident in the first place.
func Rollback(ctx context.Context, opts RollbackOptions) error {
	releasesRoot := resolveReleasesRoot(opts.Prefix, opts.ReleasesRoot)
	versions, err := ListReleaseGenerations(releasesRoot)
	if err != nil {
		return err
	}
	if len(versions) == 0 {
		return ErrNoRollbackTarget
	}

	target := opts.To
	if target == "" {
		current, curErr := CurrentReleaseVersion(releasesRoot)
		if curErr != nil {
			return curErr
		}
		if current == "" {
			return fmt.Errorf("%w: no release is currently marked as current", ErrNoRollbackTarget)
		}
		var prev string
		for _, v := range versions {
			if v == current {
				break
			}
			prev = v
		}
		if prev == "" {
			return fmt.Errorf("%w: %s is the oldest installed generation", ErrNoRollbackTarget, current)
		}
		target = prev
	}

	targetDir := filepath.Join(releasesRoot, target)
	if fi, statErr := os.Stat(targetDir); statErr != nil || !fi.IsDir() {
		return fmt.Errorf("%w: release generation %q is not installed under %s", ErrNoRollbackTarget, target, releasesRoot)
	}

	if err := applyReleaseGeneration(ctx, targetDir, target, ApplyReleaseOptions{Prefix: opts.Prefix, SlotCount: opts.SlotCount}); err != nil {
		return fmt.Errorf("rollback to %s failed to apply: %w", target, err)
	}
	if err := VerifyHost(ctx, VerifyOptions{SpecPath: filepath.Join(targetDir, "agent-host.json"), Prefix: opts.Prefix}); err != nil {
		return fmt.Errorf("rollback to %s applied but failed verification: %w", target, err)
	}
	// Only now, with the rolled-back generation applied and verified, does it become the live
	// spec that future invocations (apply, verify, sync-workspace) resolve to.
	if err := publishLiveSpec(filepath.Join(targetDir, "agent-host.json"), opts.Prefix); err != nil {
		return fmt.Errorf("rollback to %s applied and verified but failed to publish its live spec: %w", target, err)
	}
	if err := setCurrentRelease(releasesRoot, target); err != nil {
		return fmt.Errorf("rollback to %s applied and verified but failed to update current pointer: %w", target, err)
	}

	fmt.Printf("rolled back to release %s\n", target)
	return nil
}
