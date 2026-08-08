package wiki

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// MaterializeSnapshot writes a server-authoritative snapshot into a temporary
// ordinary Git repository. The resulting commit is intentionally local-only:
// it is a merge base for Git UX, never a second source of truth.
func MaterializeSnapshot(ctx context.Context, snapshot Snapshot, token string, client *Client, parent, lang string) (root, commit string, err error) {
	if lang == "" {
		lang = "ja"
	}
	root, err = os.MkdirTemp("", "gdg-wiki-snapshot-")
	if err != nil {
		return "", "", err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(root)
		}
	}()
	byID := make(map[string]Page, len(snapshot.Pages))
	for _, page := range snapshot.Pages {
		byID[page.ID] = page
	}
	for _, page := range snapshot.Pages {
		if page.PageType != nil && *page.PageType == "task-list" {
			continue
		}
		if err = WritePage(root, page, byID, token, client, lang); err != nil {
			return "", "", err
		}
	}
	if err = gitAt(ctx, root, "init", "-q"); err != nil {
		return "", "", err
	}
	if err = gitAt(ctx, root, "add", "--all"); err != nil {
		return "", "", err
	}
	// An empty Wiki is still a valid remote state and needs a fetchable commit.
	// Parent links, when needed, are created in the caller's object database.
	args := []string{"-c", "user.name=GDG Wiki", "-c", "user.email=wiki@gdgs.jp", "commit", "-q", "--allow-empty", "-m", "Wiki snapshot"}
	if err = gitAt(ctx, root, args...); err != nil {
		return "", "", err
	}
	commit, err = gitAtOutput(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", "", err
	}
	cleanup = false
	return root, strings.TrimSpace(commit), nil
}

func gitAt(ctx context.Context, directory string, args ...string) error {
	_, err := gitAtOutput(ctx, directory, args...)
	return err
}

func gitAtOutput(ctx context.Context, directory string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	command.Dir = filepath.Clean(directory)
	// A remote helper runs with GIT_DIR pointing at its caller. Snapshot
	// materialization must always create its own disposable repository instead.
	command.Env = withoutEnvironment(os.Environ(), "GIT_DIR")
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
	}
	return string(output), nil
}
