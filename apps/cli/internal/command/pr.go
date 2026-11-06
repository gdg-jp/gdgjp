package command

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdg-jp/gdgjp/cli/internal/pr/runner"
	"github.com/spf13/cobra"
)

// newPrCommand is `gdg pr`, the pr.gdgs.jp tools. Today: the OCI runner.
func newPrCommand() *cobra.Command {
	command := &cobra.Command{Use: "pr", Short: "pr.gdgs.jp (event PR) tools"}
	command.AddCommand(newPrRunnerCommand())
	return command
}

// newPrRunnerCommand is `gdg pr runner`, the systemd service next to `gdg wiki runner` on the OCI
// VM. Settings come from the environment (/etc/gdg/pr-runner.env); see infra/oci-runner/README.md.
func newPrRunnerCommand() *cobra.Command {
	var once, dryRun bool
	command := &cobra.Command{
		Use:   "runner",
		Short: "Serve pr.gdgs.jp agent jobs (plan / copy / post / fix) read-only",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg := runner.ConfigFromEnv()
			cfg.Once, cfg.DryRun, cfg.Version = once, dryRun, version
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
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Check the API, backend and yomiyasu; lease nothing")
	return command
}
