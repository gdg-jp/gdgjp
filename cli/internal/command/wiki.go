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
	var ingestCommitDocumentID string
	ingest := &cobra.Command{
		Use:   "ingest",
		Short: "Write INGEST_QUEUE.md from the local raw snapshot",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.ingest(cmd, ingestCommit, ingestAgent, ingestCommitDocumentID)
		},
	}
	ingest.Flags().BoolVar(&ingestCommit, "commit", false, "Mark a queue item as ingested in local state")
	ingest.Flags().StringVar(&ingestCommitDocumentID, "document-id", "", "With --commit, mark this document_id instead of the queue head")
	ingest.Flags().StringVar(&ingestAgent, "agent", "", "Shell out to claude, codex, or cursor with the ingest prompt")
	ingest.MarkFlagsMutuallyExclusive("commit", "agent")

	ingest.AddCommand(&cobra.Command{
		Use:   "lock",
		Short: "Claim the next unlocked pending ingest document_id",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.ingestLock(cmd)
		},
	})
	ingest.AddCommand(&cobra.Command{
		Use:   "unlock DOCUMENT_ID",
		Short: "Release an ingest lock on a document_id",
		Args:  cobra.ArbitraryArgs,
		// Document IDs may start with '-' (nanoid-style). Disable cobra flag
		// parsing so those are not treated as shorthand flags.
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			docID, force, err := parseIngestUnlockArgs(args)
			if err != nil {
				return err
			}
			return service.ingestUnlock(cmd, docID, force)
		},
	})
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

func (s *wikiService) ingestLock(cmd *cobra.Command) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	state, err := wiki.ReadState(root)
	if err != nil {
		return err
	}
	if state.Manifest == nil {
		return errors.New("no local raw snapshot; run gdg wiki raw pull first")
	}
	_, pending, err := wiki.BuildIngestQueue(root, *state.Manifest, state)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return errors.New("no claimable pending documents")
	}
	owner := wiki.LockOwner()
	locks, err := wiki.LoadLocks(root)
	if err != nil {
		return err
	}
	var lastErr error
	for _, item := range pending {
		if existing, ok := locks.Locks[item.DocumentID]; ok && existing.Owner != owner {
			continue
		}
		entry, lockErr := wiki.LockDocument(root, item.DocumentID, owner, item.ContentHash)
		if lockErr != nil {
			lastErr = lockErr
			// Another owner claimed it between LoadLocks and LockDocument; try next.
			continue
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Locked %s (owner %s).\n", entry.DocumentID, entry.Owner)
		return err
	}
	if lastErr != nil {
		return fmt.Errorf("no claimable pending documents: %w", lastErr)
	}
	return errors.New("no claimable pending documents")
}

func (s *wikiService) ingestUnlock(cmd *cobra.Command, documentID string, force bool) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	if err = wiki.UnlockDocument(root, documentID, wiki.LockOwner(), force); err != nil {
		return err
	}
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "Unlocked %s.\n", documentID)
	return err
}

func parseIngestUnlockArgs(args []string) (docID string, force bool, err error) {
	return parseIngestDocArgs("unlock", args, true)
}

func parseIngestDocArgs(command string, args []string, allowForce bool) (docID string, force bool, err error) {
	var ids []string
	for _, arg := range args {
		switch {
		case arg == "--":
			return "", false, fmt.Errorf("unexpected argument: --")
		case arg == "--force":
			if !allowForce {
				return "", false, fmt.Errorf("unknown flag: %s", arg)
			}
			force = true
		case arg == "-h", arg == "--help":
			return "", false, fmt.Errorf("help requested")
		case strings.HasPrefix(arg, "-") && arg != "-":
			// Nanoid-style IDs may start with '-'; treat any dashed token that
			// is not a known flag as the document id when we still need one.
			if allowForce && (arg == "-f") {
				force = true
				continue
			}
			if len(ids) == 0 && !isKnownIngestLockFlag(arg) {
				ids = append(ids, arg)
				continue
			}
			return "", false, fmt.Errorf("unknown flag: %s", arg)
		default:
			ids = append(ids, arg)
		}
	}
	if len(ids) != 1 {
		return "", false, fmt.Errorf("%s accepts 1 arg(s), received %d", command, len(ids))
	}
	return ids[0], force, nil
}

func isKnownIngestLockFlag(arg string) bool {
	switch arg {
	case "-h", "--help", "--force", "-f":
		return true
	default:
		return false
	}
}

func (s *wikiService) ingest(cmd *cobra.Command, commit bool, agent, commitDocumentID string) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	if commitDocumentID != "" && !commit {
		return errors.New("--document-id requires --commit")
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
		target, findErr := selectIngestCommitTarget(pending, commitDocumentID)
		if findErr != nil {
			return findErr
		}
		state.Ingested[target.DocumentID] = target.ContentHash
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
		if _, err = fmt.Fprintf(cmd.OutOrStdout(), "Marked %s as ingested.\n", target.DocumentID); err != nil {
			return err
		}
		if err = wiki.UnlockDocument(root, target.DocumentID, wiki.LockOwner(), true); err != nil {
			return err
		}
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Unlocked %s.\n", target.DocumentID)
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
	baseRev, revErr := s.runGit(cmd.Context(), root, "rev-parse", "HEAD")
	if revErr != nil {
		baseRev = ""
	}
	if err = wiki.ResetIngestTrace(root, queueHeadID, strings.TrimSpace(baseRev)); err != nil {
		return err
	}

	prompt := wiki.IngestPrompt(root, len(pending))
	if _, err = fmt.Fprintln(cmd.OutOrStdout(), prompt); err != nil {
		return err
	}
	if agent != "" {
		if agent == "cursor" {
			_, warnings, hookErr := wiki.EnsureCursorHooks(root)
			if hookErr != nil {
				return hookErr
			}
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Cursor ACL gating uses ~/.cursor/hooks.json; this clone is not a hook install target.")
			for _, warning := range warnings {
				fmt.Fprintf(cmd.ErrOrStderr(), "warning: %s\n", warning)
			}
			if len(warnings) == 0 {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "Cursor user hooks look correctly installed.")
			}
		}
		return s.runAgent(cmd.Context(), root, agent, prompt)
	}
	return nil
}

func selectIngestCommitTarget(pending []wiki.SourcesManifestEntry, documentID string) (wiki.SourcesManifestEntry, error) {
	if documentID == "" {
		return pending[0], nil
	}
	for _, doc := range pending {
		if doc.DocumentID == documentID {
			return doc, nil
		}
	}
	return wiki.SourcesManifestEntry{}, fmt.Errorf("document %s is not pending in the ingest queue", documentID)
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
