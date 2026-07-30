package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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
}

func newWikiCommand(_ store.CredentialStore) *cobra.Command {
	return newWikiCommandWithService(&wikiService{
		runGit:        runGit,
		executable:    os.Executable,
		installHelper: wiki.InstallGitRemoteHelper,
	})
}

func newWikiCommandWithService(service *wikiService) *cobra.Command {
	command := &cobra.Command{
		Use:   "wiki",
		Short: "Work with Wiki pages through Git",
	}

	var cloneRemote string
	clone := &cobra.Command{
		Use:   "clone DIRECTORY",
		Args:  cobra.ExactArgs(1),
		Short: "Clone visible Wiki pages into a Git working tree",
		RunE: func(cmd *cobra.Command, args []string) error {
			return service.clone(cmd, args[0], cloneRemote)
		},
	}
	clone.Flags().StringVar(&cloneRemote, "remote", defaultWikiRemote, "gdg-wiki Git remote URL")
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

func (s *wikiService) clone(cmd *cobra.Command, directory, remote string) error {
	if remote == "" {
		return errors.New("Wiki remote URL cannot be empty")
	}
	if _, err := s.ensureGitHelper(); err != nil {
		return err
	}
	output, err := s.runGit(cmd.Context(), "", "clone", "--origin", "origin", remote, directory)
	if err != nil {
		return err
	}
	_, err = fmt.Fprint(cmd.OutOrStdout(), output)
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
