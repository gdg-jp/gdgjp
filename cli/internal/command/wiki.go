package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/oauth"
	"github.com/gdg-jp/gdgjp/cli/internal/store"
	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
	"github.com/spf13/cobra"
)

const defaultWikiRemote = "gdg-wiki::https://wiki.gdgs.jp/api/cli/wiki"

// gitRunner is deliberately small so the command layer can be tested without
// a real Git installation. The gdg-wiki transport itself is implemented by
// git-remote-gdg-wiki, not by these commands.
type gitRunner func(context.Context, string, ...string) (string, error)

type wikiService struct {
	runGit        gitRunner
	executable    func() (string, error)
	installHelper func(string) (string, error)
	credentials   store.CredentialStore
	newClient     func() *wiki.Client
	runAgent      func(ctx context.Context, root, agent, prompt string) error
}

func newWikiCommand(credentials store.CredentialStore) *cobra.Command {
	return newWikiCommandWithService(&wikiService{
		runGit:        runGit,
		executable:    os.Executable,
		installHelper: wiki.InstallGitRemoteHelper,
		credentials:   credentials,
		newClient:     wiki.NewClient,
		runAgent:      runCodingAgent,
	})
}

func newWikiCommandWithService(service *wikiService) *cobra.Command {
	command := &cobra.Command{
		Use:   "wiki",
		Short: "Work with Wiki pages through Git",
	}

	var cloneRemote string
	var cloneLang string
	clone := &cobra.Command{
		Use:   "clone DIRECTORY",
		Args:  cobra.ExactArgs(1),
		Short: "Clone Wiki pages and raw sources into a Git working tree",
		Long:  "Creates a single-language clone (default ja) with its raw primary sources.",
		RunE: func(cmd *cobra.Command, args []string) error {
			return service.clone(cmd, args[0], cloneRemote, cloneLang)
		},
	}
	clone.Flags().StringVar(&cloneRemote, "remote", defaultWikiRemote, "gdg-wiki Git remote URL")
	clone.Flags().StringVar(&cloneLang, "lang", "ja", "Clone language (ja or en)")
	command.AddCommand(clone)

	var initRemote string
	init := &cobra.Command{
		Use:   "init DIRECTORY",
		Args:  cobra.ExactArgs(1),
		Short: "Configure an existing directory as a Wiki Git working tree",
		RunE: func(cmd *cobra.Command, args []string) error {
			return service.init(cmd, args[0], initRemote)
		},
	}
	init.Flags().StringVar(&initRemote, "remote", defaultWikiRemote, "gdg-wiki Git remote URL")
	command.AddCommand(init)

	raw := &cobra.Command{Use: "raw", Short: "Work with raw primary sources"}
	raw.AddCommand(&cobra.Command{
		Use:   "pull",
		Short: "Download raw/** for the current clone (AGENTS.md is synchronized by Git)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.rawPull(cmd)
		},
	})
	command.AddCommand(raw)

	var ingestCommit bool
	var ingestAgent string
	ingest := &cobra.Command{
		Use:   "ingest",
		Short: "Write INGEST_QUEUE.md from the local raw snapshot",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.ingest(cmd, ingestCommit, ingestAgent)
		},
	}
	ingest.Flags().BoolVar(&ingestCommit, "commit", false, "Mark the first queue item as ingested on the server")
	ingest.Flags().StringVar(&ingestAgent, "agent", "", "Shell out to claude, codex, or cursor with the ingest prompt")
	ingest.MarkFlagsMutuallyExclusive("commit", "agent")
	command.AddCommand(ingest)

	command.AddCommand(&cobra.Command{
		Use:   "verify-acl",
		Short: "Dry-run ACL validation for changed pages (fail-open on infrastructure errors)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.verifyACL(cmd)
		},
	})

	command.AddCommand(&cobra.Command{
		Use:   "lint",
		Short: "Print a lint prompt for the coding agent",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.lint(cmd)
		},
	})

	return command
}

func runGit(ctx context.Context, directory string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", args...)
	if directory != "" {
		command.Dir = directory
	}
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(string(output)))
	}
	return string(output), nil
}

func runCodingAgent(ctx context.Context, root, agent, prompt string) error {
	var name string
	switch agent {
	case "claude":
		name = "claude"
	case "codex":
		name = "codex"
	case "cursor":
		name = "cursor-agent"
	default:
		return fmt.Errorf("unsupported agent %q (use claude, codex, or cursor)", agent)
	}
	command := exec.CommandContext(ctx, name, prompt)
	command.Dir = root
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	return command.Run()
}

func (s *wikiService) clone(cmd *cobra.Command, directory, remote, lang string) error {
	if remote == "" {
		return errors.New("Wiki remote URL cannot be empty")
	}
	if lang != "ja" && lang != "en" {
		return fmt.Errorf("unsupported language %q (use ja or en)", lang)
	}
	if _, err := s.ensureGitHelper(); err != nil {
		return err
	}
	root, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	if _, err = os.Stat(root); err == nil {
		entries, readErr := os.ReadDir(root)
		if readErr != nil {
			return readErr
		}
		if len(entries) > 0 {
			return fmt.Errorf("directory %s is not empty", root)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if err = wiki.WriteConfig(root, wiki.CloneConfig{Lang: lang}); err != nil {
		return err
	}
	if err = wiki.WriteCloneGitignore(root); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "init", "-b", "main"); err != nil {
		return err
	}
	if err = wiki.WriteCloneExcludes(root); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "remote", "add", "origin", remote); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "fetch", "origin", "main"); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "reset", "--hard", "refs/remotes/origin/main"); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "config", "branch.main.remote", "origin"); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "config", "branch.main.merge", "refs/heads/main"); err != nil {
		return err
	}
	if err = s.syncRaw(cmd.Context(), root); err != nil {
		return fmt.Errorf("sync raw Wiki content: %w", err)
	}
	_, err = fmt.Fprintf(
		cmd.OutOrStdout(),
		"Cloned Wiki into %s (lang=%s; pages and AGENTS.md are Git-synchronized; raw sources downloaded).\n",
		root,
		lang,
	)
	return err
}

func (s *wikiService) ensureGitHelper() (string, error) {
	executable, err := s.executable()
	if err != nil {
		return "", fmt.Errorf("locate gdg executable: %w", err)
	}
	installer := s.installHelper
	if installer == nil {
		installer = wiki.InstallGitRemoteHelper
	}
	helper, err := installer(executable)
	if err != nil {
		return "", err
	}
	return helper, nil
}

func (s *wikiService) init(cmd *cobra.Command, directory, remote string) error {
	if remote == "" {
		return errors.New("Wiki remote URL cannot be empty")
	}
	root, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "rev-parse", "--is-inside-work-tree"); err != nil {
		if _, err = s.runGit(cmd.Context(), root, "init", "-b", "main"); err != nil {
			return err
		}
	}
	if err = wiki.WriteCloneExcludes(root); err != nil {
		return err
	}
	if _, err = os.Stat(wiki.ConfigPath(root)); os.IsNotExist(err) {
		if err = wiki.WriteConfig(root, wiki.CloneConfig{Lang: "ja"}); err != nil {
			return err
		}
	}
	if _, err = os.Stat(filepath.Join(root, ".gitignore")); os.IsNotExist(err) {
		if err = wiki.WriteCloneGitignore(root); err != nil {
			return err
		}
	}
	if _, err = s.runGit(cmd.Context(), root, "remote", "get-url", "origin"); err != nil {
		if _, err = s.runGit(cmd.Context(), root, "remote", "add", "origin", remote); err != nil {
			return err
		}
	} else if _, err = s.runGit(cmd.Context(), root, "remote", "set-url", "origin", remote); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "config", "branch.main.remote", "origin"); err != nil {
		return err
	}
	if _, err = s.runGit(cmd.Context(), root, "config", "branch.main.merge", "refs/heads/main"); err != nil {
		return err
	}
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "Configured Wiki Git remote in %s. Run `cd %s && git pull` to fetch pages.\n", root, root)
	return err
}

func (s *wikiService) findRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	return findWikiRoot(wd)
}

func findWikiRoot(start string) (string, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		if info, statErr := os.Stat(wiki.ConfigPath(dir)); statErr == nil && info.Mode().IsRegular() {
			if _, configErr := wiki.ReadConfig(dir); configErr != nil {
				return "", configErr
			}
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("not inside a Wiki clone (missing .gdgwiki/config.json)")
		}
		dir = parent
	}
}

func (s *wikiService) withToken(ctx context.Context, fn func(string) error) error {
	if s.credentials == nil {
		return errors.New("credentials store is not configured")
	}
	credential, err := s.credentials.Load()
	if err != nil {
		return fmt.Errorf("load credentials (run gdg login): %w", err)
	}
	err = fn(credential.AccessToken)
	if !isWikiUnauthorized(err) {
		return err
	}
	fresh, refreshErr := oauth.Refresh(ctx, credential.RefreshToken)
	if refreshErr != nil {
		return fmt.Errorf("refresh GDG Japan login: %w", refreshErr)
	}
	if saveErr := s.credentials.Save(fresh); saveErr != nil {
		return saveErr
	}
	return fn(fresh.AccessToken)
}

func isWikiUnauthorized(err error) bool {
	var httpErr *wiki.HTTPError
	return errors.As(err, &httpErr) && httpErr.StatusCode == 401
}

func (s *wikiService) rawPull(cmd *cobra.Command) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	if err = s.syncRaw(cmd.Context(), root); err != nil {
		return err
	}
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "Updated raw/** in %s (AGENTS.md is synchronized by Git)\n", root)
	return err
}

func (s *wikiService) syncRaw(ctx context.Context, root string) error {
	client := s.newClient()
	return s.withToken(ctx, func(token string) error {
		_, err := wiki.PullRaw(ctx, root, client, token)
		return err
	})
}

func (s *wikiService) ingest(cmd *cobra.Command, commit bool, agent string) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	if commit {
		status, statusErr := s.runGit(cmd.Context(), root, "status", "--porcelain", "--untracked-files=all")
		if statusErr != nil {
			return fmt.Errorf("check Wiki worktree: %w", statusErr)
		}
		if strings.TrimSpace(status) != "" {
			return errors.New("cannot finalize Wiki ingest with uncommitted or untracked changes; commit and git push first")
		}
	}
	if commit {
		if _, err = s.runGit(cmd.Context(), root, "pull", "--ff-only"); err != nil {
			return fmt.Errorf("git pull: %w", err)
		}
		head, headErr := s.runGit(cmd.Context(), root, "rev-parse", "HEAD")
		if headErr != nil {
			return fmt.Errorf("resolve Wiki HEAD: %w", headErr)
		}
		remote, remoteErr := s.runGit(cmd.Context(), root, "rev-parse", "refs/remotes/origin/main")
		if remoteErr != nil {
			return fmt.Errorf("resolve Wiki origin/main: %w", remoteErr)
		}
		if strings.TrimSpace(head) != strings.TrimSpace(remote) {
			return errors.New("cannot finalize Wiki ingest before HEAD is synchronized with origin/main; commit and git push first")
		}
	}
	var pending []wiki.SourcesManifestEntry
	state, err := wiki.ReadState(root)
	if err != nil {
		return err
	}
	if state.Manifest == nil {
		return errors.New("no local raw snapshot; run gdg wiki raw pull first")
	}
	_, pending, err = wiki.BuildIngestQueue(root, *state.Manifest, state)
	if err != nil {
		return err
	}
	if commit {
		if len(pending) == 0 {
			return errors.New("no pending documents to mark as ingested")
		}
		if err = s.verifyACLStrict(cmd); err != nil {
			return err
		}
		first := pending[0]
		state.Ingested[first.DocumentID] = first.ContentHash
		if err = wiki.WriteState(root, state); err != nil {
			return err
		}
		if err = wiki.ClearIngestTrace(root); err != nil {
			return err
		}
		_, pending, err = wiki.BuildIngestQueue(root, *state.Manifest, state)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Marked %s as ingested.\n", first.DocumentID)
	}
	if err != nil {
		return err
	}
	if commit {
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Queue refreshed; %d pending item(s) remain. Start a new ingest task to process the next item.\n", len(pending))
		return err
	}

	queueHeadID := ""
	if len(pending) > 0 {
		queueHeadID = pending[0].DocumentID
	}
	if err = wiki.ResetIngestTrace(root, queueHeadID); err != nil {
		return err
	}

	prompt := wiki.IngestPrompt(root, len(pending))
	if _, err = fmt.Fprintln(cmd.OutOrStdout(), prompt); err != nil {
		return err
	}
	if agent != "" {
		if agent == "cursor" {
			updated, hookErr := wiki.EnsureCursorHooks(root)
			if hookErr != nil {
				return hookErr
			}
			if updated {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Installed Cursor ACL hooks in this Wiki clone.")
			} else {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Cursor ACL hooks already up to date.")
			}
		}
		return s.runAgent(cmd.Context(), root, agent, prompt)
	}
	return nil
}

// runVerifyACL executes the dry-run gate. Infrastructure failures return a
// warning and ok=true (fail open). ACL findings return ok=false with no error.
func (s *wikiService) runVerifyACL(cmd *cobra.Command) (ok bool, err error) {
	root, err := s.findRoot()
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: ACL verify skipped (%v)\n", err)
		return true, nil
	}
	state, err := wiki.LoadState(root)
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: ACL verify skipped (%v)\n", err)
		return true, nil
	}
	if state.Manifest == nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: ACL verify skipped (no local raw snapshot)\n")
		return true, nil
	}
	client := s.newClient()
	var result wiki.ValidateACLResult
	err = s.withToken(cmd.Context(), func(token string) error {
		var verifyErr error
		result, verifyErr = wiki.VerifyACL(cmd.Context(), root, client, token, wiki.GitRunner(s.runGit))
		return verifyErr
	})
	if err != nil {
		fmt.Fprintf(cmd.ErrOrStderr(), "warning: ACL verify failed open (%v)\n", err)
		return true, nil
	}
	if result.OK {
		return true, nil
	}
	fmt.Fprintln(cmd.OutOrStdout(), wiki.FormatACLFindings(result.Findings))
	return false, nil
}

// verifyACLStrict fails closed on ACL violations but still fail-opens on
// infrastructure errors, matching `gdg wiki verify-acl`.
func (s *wikiService) verifyACLStrict(cmd *cobra.Command) error {
	ok, err := s.runVerifyACL(cmd)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	return errors.New("ACL validation failed; fix <acl> tags or page visibility before --commit")
}

func (s *wikiService) verifyACL(cmd *cobra.Command) error {
	ok, err := s.runVerifyACL(cmd)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	// Cobra maps returned errors to exit 1 — the only fail-closed path.
	return errors.New("ACL validation failed")
}

func (s *wikiService) lint(cmd *cobra.Command) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(cmd.OutOrStdout(), wiki.LintPrompt(root))
	return err
}
