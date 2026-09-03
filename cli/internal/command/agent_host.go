package command

import (
	"fmt"
	"os"
	"strconv"

	"github.com/gdg-jp/gdgjp/cli/internal/agenthost"
	"github.com/spf13/cobra"
)

func newAgentHostCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "agent-host",
		Short: "Provision the self-hosted GDG agent host",
	}
	command.AddCommand(newEmitLayoutCommand())
	return command
}

func newEmitLayoutCommand() *cobra.Command {
	var prefix string
	var specPath string
	var slotCount int
	var applyOwnership bool
	command := &cobra.Command{
		Use:   "emit-layout",
		Short: "Write the /opt/gdg-agent layout from the embedded hook bundle",
		Long: "Generates the agent-host file tree (lib, bin, sudoers, tmpfiles, per-slot Cursor config)\n" +
			"from assets embedded in this binary. Does not require node, pnpm, or a monorepo clone\n" +
			"on the hook placement path. Pass --prefix for tests. --apply-ownership performs live\n" +
			"chown/chmod/apparmor/linger and is a no-op when --prefix is set or the process is not root.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if specPath == "" {
				specPath = os.Getenv("GDG_SPEC")
			}
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}
			if slotCount == 0 {
				if env := os.Getenv("GDG_AGENT_SLOT_COUNT"); env != "" {
					n, err := strconv.Atoi(env)
					if err != nil || n < 1 {
						return fmt.Errorf("GDG_AGENT_SLOT_COUNT must be a positive integer")
					}
					slotCount = n
				}
			}
			return agenthost.EmitLayout(agenthost.EmitOptions{
				SpecPath:       specPath,
				Prefix:         prefix,
				SlotCount:      slotCount,
				ApplyOwnership: applyOwnership,
			})
		},
	}
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	command.Flags().BoolVar(&applyOwnership, "apply-ownership", false, "Apply live chown/chmod/apparmor/linger (no-op with --prefix)")
	return command
}
