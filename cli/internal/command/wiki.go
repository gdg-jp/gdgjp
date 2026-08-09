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
	runAgent      func(context.Context, string, string) error
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
		Short: "Download raw/** and AGENTS.md for the current clone",
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
		Short: "Refresh pages/raw and write INGEST_QUEUE.md",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return service.ingest(cmd, ingestCommit, ingestAgent)
		},
	}
	ingest.Flags().BoolVar(&ingestCommit, "commit", false, "Mark the first queue item as ingested on the server")
	ingest.Flags().StringVar(&ingestAgent, "agent", "", "Shell out to claude or codex with the ingest prompt")
	ingest.MarkFlagsMutuallyExclusive("commit", "agent")
	command.AddCommand(ingest)

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

func runCodingAgent(ctx context.Context, agent, prompt string) error {
	var name string
	switch agent {
	case "claude":
		name = "claude"
	case "codex":
		name = "codex"
	default:
		return fmt.Errorf("unsupported agent %q (use claude or codex)", agent)
	}
	command := exec.CommandContext(ctx, name, prompt)
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
		"Cloned Wiki into %s (lang=%s; pages, raw sources, and AGENTS.md synchronized).\n",
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
	_, err = fmt.Fprintf(cmd.OutOrStdout(), "Updated raw/** and AGENTS.md in %s\n", root)
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
	if _, err = s.runGit(cmd.Context(), root, "pull", "--ff-only"); err != nil {
		return fmt.Errorf("git pull: %w", err)
	}
	if commit {
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
	client := s.newClient()
	var pending []wiki.SourcesManifestEntry
	err = s.withToken(cmd.Context(), func(token string) error {
		manifest, pullErr := wiki.PullRaw(cmd.Context(), root, client, token)
		if pullErr != nil {
			return pullErr
		}
		state, stateErr := wiki.ReadState(root)
		if stateErr != nil {
			return stateErr
		}
		_, pending, err = wiki.BuildIngestQueue(root, manifest, state)
		if err != nil {
			return err
		}
		if commit {
			if len(pending) == 0 {
				return errors.New("no pending documents to mark as ingested")
			}
			first := pending[:1]
			if markErr := client.MarkIngested(cmd.Context(), token, first); markErr != nil {
				return markErr
			}
			state.Ingested[first[0].DocumentID] = first[0].ContentHash
			if writeErr := wiki.WriteState(root, state); writeErr != nil {
				return writeErr
			}
			_, pending, err = wiki.BuildIngestQueue(root, manifest, state)
			if err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "Marked %s as ingested.\n", first[0].DocumentID)
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	if commit {
		_, err = fmt.Fprintf(cmd.OutOrStdout(), "Queue refreshed; %d pending item(s) remain. Start a new ingest task to process the next item.\n", len(pending))
		return err
	}
	prompt := wiki.IngestPrompt(root, len(pending))
	if _, err = fmt.Fprintln(cmd.OutOrStdout(), prompt); err != nil {
		return err
	}
	if agent != "" {
		return s.runAgent(cmd.Context(), agent, prompt)
	}
	return nil
}

func (s *wikiService) lint(cmd *cobra.Command) error {
	root, err := s.findRoot()
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(cmd.OutOrStdout(), wiki.LintPrompt(root))
	return err
}
