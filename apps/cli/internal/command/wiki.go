package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/cliutil"
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
	// readSources is verify-acl's --read-sources (the job's sources); required.
	readSources []string
}

type cloneOptions struct {
	Lang       string
	Space      string
	RawSources []string
	NoRaw      bool
}

func newWikiCommand(credentials store.CredentialStore) *cobra.Command {
	return newWikiCommandWithService(&wikiService{
		runGit:        runGit,
		executable:    os.Executable,
		installHelper: wiki.InstallGitRemoteHelper,
		credentials:   credentials,
		newClient:     wiki.NewClient,
	})
}

func newWikiCommandWithService(service *wikiService) *cobra.Command {
	command := &cobra.Command{
		Use:   "wiki",
		Short: "Work with Wiki pages through Git",
	}

	var cloneRemote string
	var cloneOptions cloneOptions
	clone := &cobra.Command{
		Use:   "clone DIRECTORY",
		Args:  cobra.ExactArgs(1),
		Short: "Clone Wiki pages and raw sources into a Git working tree",
		Long:  "Creates a single-language clone (default ja) of one space with its raw primary sources.",
		RunE: func(cmd *cobra.Command, args []string) error {
			return service.cloneWith(cmd, args[0], cloneRemote, cloneOptions)
		},
	}
	clone.Flags().StringVar(&cloneRemote, "remote", defaultWikiRemote, "gdg-wiki Git remote URL")
	clone.Flags().StringVar(&cloneOptions.Lang, "lang", "ja", "Clone language (ja or en)")
	clone.Flags().StringVar(&cloneOptions.Space, "space", "", "Space slug to clone (default gdg-jp)")
	clone.Flags().StringSliceVar(&cloneOptions.RawSources, "raw-sources", nil, "Download raw files of these source ids only")
	clone.Flags().BoolVar(&cloneOptions.NoRaw, "no-raw", false, "Keep the source manifest but download no raw files")
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

	var readSources []string
	verify := &cobra.Command{
		Use:   "verify-acl",
		Short: "Dry-run ACL validation for changed pages (fail-open on infrastructure errors)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if !cmd.Flags().Changed("read-sources") {
				return errors.New("--read-sources is required (the source ids the agent read; may be empty: --read-sources=)")
			}
			service.readSources = append([]string{}, readSources...)
			return service.verifyACL(cmd)
		},
	}
	verify.Flags().StringSliceVar(&readSources, "read-sources", nil, "Source ids the agent read (required; empty for page-only runs)")
	command.AddCommand(verify)

	command.AddCommand(newWikiRunnerCommand(service))
	command.AddCommand(newWikiMCPCommand())
	command.AddCommand(newWikiJudgeCommand())

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

func (s *wikiService) clone(cmd *cobra.Command, directory, remote, lang string) error {
	return s.cloneWith(cmd, directory, remote, cloneOptions{Lang: lang})
}

func (s *wikiService) cloneWith(cmd *cobra.Command, directory, remote string, options cloneOptions) error {
	lang := options.Lang
	if remote == "" {
		return errors.New("Wiki remote URL cannot be empty")
	}
	if lang != "ja" && lang != "en" {
		return fmt.Errorf("unsupported language %q (use ja or en)", lang)
	}
	if options.Space != "" && !wiki.ValidSpaceSlug(options.Space) {
		return fmt.Errorf("invalid space %q", options.Space)
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
	if err = wiki.WriteConfig(root, wiki.CloneConfig{
		Lang: lang, Space: options.Space, RawSources: options.RawSources, NoRaw: options.NoRaw,
	}); err != nil {
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
	if token := os.Getenv(wiki.TokenEnv); token != "" {
		return fn(token)
	}
	if s.credentials == nil {
		return errors.New("credentials store is not configured")
	}
	_, err := cliutil.WithToken(ctx, loadTaggingCredentialStore{s.credentials}, func(token string) (struct{}, error) {
		return struct{}{}, fn(token)
	})
	var loadErr *taggedLoadError
	if errors.As(err, &loadErr) {
		return fmt.Errorf("load credentials (run gdg login): %w", loadErr.cause)
	}
	return err
}

// loadTaggingCredentialStore preserves wiki's existing
// "load credentials (run gdg login): %w" wrapper for every Load failure (not
// only store.ErrNotFound) now that the retry flow is shared via
// cliutil.WithToken. The tag is deliberately not Unwrap-able to
// store.ErrNotFound, so cliutil.WithToken's own ErrNotFound short-circuit
// (which returns its own generic NotLoggedInError) never fires here; wiki's
// wrapper is restored afterwards from the tagged error instead.
type loadTaggingCredentialStore struct {
	store.CredentialStore
}

type taggedLoadError struct{ cause error }

func (e *taggedLoadError) Error() string { return e.cause.Error() }

func (s loadTaggingCredentialStore) Load() (store.Credentials, error) {
	credentials, err := s.CredentialStore.Load()
	if err != nil {
		return credentials, &taggedLoadError{cause: err}
	}
	return credentials, nil
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
		result, verifyErr = wiki.VerifyACLWithReadSources(cmd.Context(), root, client, token, wiki.GitRunner(s.runGit), s.readSources)
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
