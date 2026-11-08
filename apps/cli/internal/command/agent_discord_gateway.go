package command

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/gdg-jp/gdgjp/cli/internal/discordgw"
	"github.com/spf13/cobra"
)

// newDiscordGatewayCommand is `gdg agent discord-gateway`, a systemd service on the OCI VM
// (gdg-discord-gateway). Settings come from /etc/gdg/discord-gateway.env; see
// infra/oci-runner/README.md.
func newDiscordGatewayCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "discord-gateway",
		Short: "Keep the GDG Agent bot online and forward @mentions and DMs to agent.gdgs.jp",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			g, err := discordgw.New(discordgw.ConfigFromEnv())
			if err != nil {
				return err
			}
			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()
			err = g.Run(ctx)
			if ctx.Err() != nil && err == context.Canceled {
				return nil
			}
			return err
		},
	}
}
