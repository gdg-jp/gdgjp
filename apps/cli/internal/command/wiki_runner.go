package command

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
	"github.com/spf13/cobra"
)

// newWikiRunnerCommand is `gdg wiki runner`, the systemd service on the OCI VM. Settings
// come from the environment (/etc/gdg/runner.env); see infra/oci-runner/README.md.
func newWikiRunnerCommand(service *wikiService) *cobra.Command {
	var once, dryRun bool
	command := &cobra.Command{
		Use:   "runner",
		Short: "Serve agent jobs (synthesize / consolidate / translate) for the Wiki",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := runner.ConfigFromEnv()
			cfg.Once, cfg.DryRun, cfg.Version = once, dryRun, version
			// The runner's clones push through git-remote-gdg-wiki, like a person's.
			if _, err := service.ensureGitHelper(); err != nil {
				return err
			}
			var err error
			if cfg.Executable, err = service.executable(); err != nil {
				return err
			}
			r, err := runner.New(cfg, nil)
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			err = r.Run(ctx)
			if ctx.Err() != nil && err == context.Canceled {
				return nil
			}
			return err
		},
	}
	command.Flags().BoolVar(&once, "once", false, "Serve at most one job, then exit")
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Check the API and backend, lease nothing")
	return command
}
