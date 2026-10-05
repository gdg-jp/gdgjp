package agenthost

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// GitResource clones and checks out a pinned git commit ref.
type GitResource struct {
	Destination string
	Repo        string
	Ref         string
	Symlink     string
	Prefix      string
}

func (g *GitResource) ID() string {
	return "git:" + g.Destination
}

func (g *GitResource) ResourceType() string {
	return "git"
}

func (g *GitResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   g.ID(),
		ResourceType: g.ResourceType(),
		Action:       ActionNone,
	}

	if g.Prefix != "" {
		return ch, nil
	}

	gitDir := filepath.Join(g.Destination, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		if os.IsNotExist(err) {
			ch.Action = ActionCreate
			ch.Diff = fmt.Sprintf("+ clone %s (%s) -> %s", g.Repo, g.Ref, g.Destination)
			return ch, nil
		}
		return ch, err
	}

	cmd := exec.Command("git", "-c", "safe.directory="+g.Destination, "-C", g.Destination, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		ch.Action = ActionUpdate
		ch.Diff = fmt.Sprintf("~ ref error in %s: %v", g.Destination, err)
		return ch, nil
	}

	head := strings.TrimSpace(string(out))
	if head != g.Ref {
		ch.Action = ActionUpdate
		ch.Diff = fmt.Sprintf("~ checkout %s from %s to %s", g.Destination, head, g.Ref)
		return ch, nil
	}

	return ch, nil
}

func (g *GitResource) Apply(ctx context.Context, c Change) error {
	if g.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	gitDir := filepath.Join(g.Destination, ".git")
	if _, err := os.Stat(gitDir); err != nil && os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(g.Destination), 0o755); err != nil {
			return err
		}
		cloneCmd := exec.Command("git", "clone", g.Repo, g.Destination)
		if out, err := cloneCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git clone %s failed: %w (%s)", g.Repo, err, string(out))
		}
	} else {
		fetchCmd := exec.Command("git", "-c", "safe.directory="+g.Destination, "-C", g.Destination, "fetch", "origin")
		if out, err := fetchCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("git fetch in %s failed: %w (%s)", g.Destination, err, string(out))
		}
	}

	checkoutCmd := exec.Command("git", "-c", "safe.directory="+g.Destination, "-C", g.Destination, "checkout", "--detach", g.Ref)
	if out, err := checkoutCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git checkout %s failed: %w (%s)", g.Ref, err, string(out))
	}

	cmd := exec.Command("git", "-c", "safe.directory="+g.Destination, "-C", g.Destination, "rev-parse", "HEAD")
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("rev-parse HEAD failed in %s: %w", g.Destination, err)
	}
	head := strings.TrimSpace(string(out))
	if head != g.Ref {
		return fmt.Errorf("git checkout did not reach %s (current HEAD: %s)", g.Ref, head)
	}

	if g.Symlink != "" {
		sourceBin := filepath.Join(g.Destination, "bin", filepath.Base(g.Symlink))
		if _, err := os.Stat(sourceBin); err == nil {
			_ = os.MkdirAll(filepath.Dir(g.Symlink), 0o755)
			_ = os.Remove(g.Symlink)
			if err := os.Symlink(sourceBin, g.Symlink); err != nil {
				return fmt.Errorf("symlink %s -> %s: %w", g.Symlink, sourceBin, err)
			}
		}
	}

	return nil
}
