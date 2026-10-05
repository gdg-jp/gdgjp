package agenthost

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
)

// WikiCloneResource conditionally performs the initial clone of gdg wiki into workspace.
// If credentials are not yet configured for the service user, it skips cleanly with an informative message.
type WikiCloneResource struct {
	WikiRoot string
	Prefix   string
	User     string
}

func (w *WikiCloneResource) ID() string {
	return w.WikiRoot
}

func (w *WikiCloneResource) ResourceType() string {
	return "wiki"
}

func (w *WikiCloneResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   w.ID(),
		ResourceType: w.ResourceType(),
		Action:       ActionNone,
	}

	if w.Prefix != "" {
		return ch, nil
	}

	gitMarker := filepath.Join(w.WikiRoot, ".git")
	if _, err := os.Stat(gitMarker); err == nil {
		// Already cloned (directory or git worktree file)
		return ch, nil
	}

	// Check if service user has credentials to clone
	u, err := user.Lookup(w.User)
	if err != nil {
		return ch, nil
	}

	authJSON := filepath.Join(u.HomeDir, ".config", "gdg", "auth.json")
	credsJSON := filepath.Join(u.HomeDir, ".config", "gdg", "credentials.json")
	hasAuth := false
	if info, err := os.Stat(authJSON); err == nil && info.Size() > 0 {
		hasAuth = true
	} else if info, err := os.Stat(credsJSON); err == nil && info.Size() > 0 {
		hasAuth = true
	}

	if !hasAuth {
		// Credentials not configured yet; clean skip during planning
		return ch, nil
	}

	ch.Action = ActionCreate
	ch.Diff = fmt.Sprintf("+ clone gdg wiki into %s", w.WikiRoot)
	return ch, nil
}

func (w *WikiCloneResource) Apply(ctx context.Context, c Change) error {
	if w.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	gitMarker := filepath.Join(w.WikiRoot, ".git")
	if _, err := os.Stat(gitMarker); err == nil {
		return nil
	}

	gdgBin, err := exec.LookPath("gdg")
	if err != nil {
		gdgBin = "/usr/local/bin/gdg"
	}

	// Reuse runAsUser to ensure complete HOME, XDG environment, and runtime dirs are set
	if err := runAsUser(w.User, gdgBin, "wiki", "clone", w.WikiRoot); err != nil {
		return fmt.Errorf("gdg wiki clone failed for %s: %w", w.WikiRoot, err)
	}

	return nil
}
