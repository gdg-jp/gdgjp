package command

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/agenthost"
	"github.com/spf13/cobra"
)

func newAgentHostCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "agent-host",
		Short: "Provision the self-hosted GDG agent host",
	}
	command.AddCommand(newEmitLayoutCommand())
	command.AddCommand(newAgentHostApplyCommand())
	command.AddCommand(newAgentHostRenderCommand())
	command.AddCommand(newAgentHostVerifyCommand())
	command.AddCommand(newAgentHostSecretsCommand())
	return command
}

func newAgentHostApplyCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var prefix string
	var slotCount int
	var dryRun bool
	var diff bool
	var only string
	var prune bool

	command := &cobra.Command{
		Use:   "apply",
		Short: "Apply declarative host configuration against localhost",
		Long: "Compares desired state defined in the agent-host spec against host state and\n" +
			"converges only differences. In --dry-run mode, plans changes without applying\n" +
			"them and exits non-zero if drift is detected. Pass --prune to clean up decommissioned\n" +
			"slots (users, home directories, and run directories).",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if specPath == "" {
				specPath = os.Getenv("GDG_SPEC")
			}
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}

			// Self re-exec check on live paths
			if prefix == "" {
				spec, err := agenthost.LoadSpecWithOverlay(specPath, overlayPath)
				if err == nil && spec.Pins.GdgCli.Version != "" {
					if err := agenthost.CheckAndReexecSelf(context.Background(), cmd.Root().Version, spec.Pins.GdgCli, os.Args, nil); err != nil {
						return fmt.Errorf("self re-exec failed: %w", err)
					}
				}
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

			plan, err := agenthost.BuildPlan(context.Background(), agenthost.PlanOptions{
				SpecPath:    specPath,
				OverlayPath: overlayPath,
				Prefix:      prefix,
				SlotCount:   slotCount,
				Only:        only,
				Prune:       prune,
			})
			if err != nil {
				return err
			}

			return agenthost.ApplyPlan(context.Background(), plan, agenthost.ApplyOptions{
				DryRun: dryRun,
				Diff:   diff,
			})
		},
	}
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Plan changes only and exit non-zero on drift")
	command.Flags().BoolVar(&diff, "diff", false, "Print detailed diffs of planned changes")
	command.Flags().StringVar(&only, "only", "", "Filter resource types to apply (file, dir, user, sudoers, tmpfiles)")
	command.Flags().BoolVar(&prune, "prune", false, "Remove decommissioned slot users, home directories, and run directories")
	return command
}

func newAgentHostRenderCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var outDir string
	var slotCount int

	command := &cobra.Command{
		Use:   "render",
		Short: "Render the agent-host directory tree without modifying host state",
		Long: "Renders the full file layout tree into the directory specified by --out.\n" +
			"Useful for golden testing and offline layout inspection.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if outDir == "" {
				return fmt.Errorf("--out directory is required")
			}
			if specPath == "" {
				specPath = os.Getenv("GDG_SPEC")
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

			return agenthost.RenderLayout(specPath, overlayPath, outDir, slotCount)
		},
	}
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().StringVar(&outDir, "out", "", "Directory to render layout files into (required)")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	_ = command.MarkFlagRequired("out")
	return command
}

func newEmitLayoutCommand() *cobra.Command {
	var prefix string
	var specPath string
	var overlayPath string
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
				OverlayPath:    overlayPath,
				Prefix:         prefix,
				SlotCount:      slotCount,
				ApplyOwnership: applyOwnership,
				Prune:          true,
			})
		},
	}
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	command.Flags().BoolVar(&applyOwnership, "apply-ownership", false, "Apply live chown/chmod/apparmor/linger (no-op with --prefix)")
	return command
}

func newAgentHostVerifyCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var prefix string

	command := &cobra.Command{
		Use:   "verify",
		Short: "Run verification checks on agent host isolation boundary",
		Long: "Verifies the 13 agent-host security boundaries (credential access, wiki permissions,\n" +
			"slot separation, binary/script write protections, and worktree isolation).\n" +
			"Exits 0 if all checks pass, or non-zero if any expectation fails.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if specPath == "" {
				specPath = os.Getenv("GDG_SPEC")
			}
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}
			return agenthost.VerifyHost(context.Background(), agenthost.VerifyOptions{
				SpecPath:    specPath,
				OverlayPath: overlayPath,
				Prefix:      prefix,
			})
		},
	}
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().StringVar(&prefix, "prefix", "", "Skip live host checks under prefix mode")
	return command
}

func newAgentHostSecretsCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "secrets",
		Short: "Manage operator and service secrets for agent host",
	}

	var slotCount int

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show status of required host credentials and tokens",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if slotCount == 0 {
				if env := os.Getenv("GDG_AGENT_SLOT_COUNT"); env != "" {
					slotCount, _ = strconv.Atoi(env)
				}
			}
			return agenthost.SecretsStatus(slotCount)
		},
	}
	statusCmd.Flags().IntVar(&slotCount, "slot-count", 0, "Number of slot accounts to verify")

	importCmd := &cobra.Command{
		Use:   "import",
		Short: "Import operator secrets from $SUDO_USER into service accounts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if slotCount == 0 {
				if env := os.Getenv("GDG_AGENT_SLOT_COUNT"); env != "" {
					slotCount, _ = strconv.Atoi(env)
				}
			}
			return agenthost.SecretsImportFromOperator(slotCount)
		},
	}
	importCmd.Flags().IntVar(&slotCount, "slot-count", 0, "Number of slot accounts to populate")
	importCmd.Flags().Bool("from-operator", true, "Import from $SUDO_USER home directory")

	setCmd := &cobra.Command{
		Use:   "set [target]",
		Short: "Interactively set a secret (discord, langfuse)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			switch strings.ToLower(args[0]) {
			case "discord":
				return agenthost.SecretsSetDiscord()
			case "langfuse":
				return agenthost.SecretsSetLangfuse()
			default:
				return fmt.Errorf("unknown secret target %q (valid: discord, langfuse)", args[0])
			}
		},
	}

	loginCmd := &cobra.Command{
		Use:   "login",
		Short: "Execute gdg login --device as gdgagent-svc user",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return agenthost.SecretsLogin()
		},
	}

	command.AddCommand(statusCmd, importCmd, setCmd, loginCmd)
	return command
}
