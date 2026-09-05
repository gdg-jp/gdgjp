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
	command.AddCommand(newAgentHostSyncWorkspaceCommand())
	command.AddCommand(newAgentHostValidateSpecCommand())
	command.AddCommand(newAgentHostReleaseCommand())
	command.AddCommand(newAgentHostRollbackCommand())
	return command
}

// resolveSpecPath applies the shared fallback chain used by every agent-host subcommand:
// an explicit --spec flag wins, then GDG_SPEC, then (Stage 10) the live spec published by the
// most recent successful `gdg agent-host release apply` at agenthost.LiveSpecPath, so a
// config-only release takes effect for every future invocation without a manual --spec. Falls
// through to the embedded default spec (via LoadSpecWithOverlay's own fallback) if none exist.
func resolveSpecPath(explicit string) string {
	if explicit != "" {
		return explicit
	}
	if env := os.Getenv("GDG_SPEC"); env != "" {
		return env
	}
	if _, err := os.Stat(agenthost.LiveSpecPath); err == nil {
		return agenthost.LiveSpecPath
	}
	return ""
}

// selfReexecAllowed reports whether specPath (as returned by resolveSpecPath) came from an
// authoritative source -- an explicit --spec, GDG_SPEC, or the published live spec -- rather than
// falling through to the binary's own embedded default. An embedded spec from a past release
// cannot be trusted to drive replacement of the currently running binary: since older releases
// can pin gdgCli to a version older than themselves, chasing it would walk the self re-exec chain
// backwards through history instead of converging on the intended version.
func selfReexecAllowed(specPath string) bool {
	return specPath != ""
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
			specPath = resolveSpecPath(specPath)
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}

			// Self re-exec check on live paths
			if prefix == "" && selfReexecAllowed(specPath) {
				spec, err := agenthost.LoadSpecWithOverlay(specPath, overlayPath)
				if err == nil && spec.Pins.GdgCli.Version != "" {
					if err := agenthost.CheckAndReexecSelf(context.Background(), cmd.Root().Version, spec, os.Args, nil); err != nil {
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
	command.Flags().StringVar(&only, "only", "", "Filter resource types to apply (user, group, dir, file, sudoers, tmpfiles, symlink, systemd, apparmor, apt, tarball, git, wiki, exec)")
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
			specPath = resolveSpecPath(specPath)
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
			specPath = resolveSpecPath(specPath)
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
			specPath = resolveSpecPath(specPath)
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
		Short: "Interactively set a secret (discord, langfuse, npm-registry)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			switch strings.ToLower(args[0]) {
			case "discord":
				return agenthost.SecretsSetDiscord()
			case "langfuse":
				return agenthost.SecretsSetLangfuse()
			case "npm-registry":
				return agenthost.SecretsSetNpmRegistry()
			default:
				return fmt.Errorf("unknown secret target %q (valid: discord, langfuse, npm-registry)", args[0])
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

func newAgentHostSyncWorkspaceCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var prefix string
	var source string
	var pubKeyPath string
	var dryRun bool
	var diff bool
	var force bool

	command := &cobra.Command{
		Use:   "sync-workspace",
		Short: "Synchronize agent workspace skills and rules into live worktree (Tier 1)",
		Long: "Synchronizes agent-host/workspace/** (.agents, .claude, .codex, AGENTS.md -> local.mdc)\n" +
			"into /srv/gdg-agent/wiki while holding the wiki mutex. Uses Ed25519 signature\n" +
			"verification, defensive archive extraction, and Mode B write-ahead journal crash recovery.\n" +
			"--force permits overwriting managed files when local changes are detected.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			specPath = resolveSpecPath(specPath)
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}
			return agenthost.SyncWorkspace(context.Background(), agenthost.SyncWorkspaceOptions{
				Source:      source,
				DryRun:      dryRun,
				Diff:        diff,
				Force:       force,
				SpecPath:    specPath,
				OverlayPath: overlayPath,
				Prefix:      prefix,
				PubKeyPath:  pubKeyPath,
			})
		},
	}
	command.Flags().StringVar(&source, "source", "", "Path to bundle archive, manifest, or workspace directory")
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().StringVar(&pubKeyPath, "pubkey", "", "Path to Ed25519 verification public key")
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Check for drift without modifying live worktree")
	command.Flags().BoolVar(&diff, "diff", false, "Print planned additions, modifications, and deletions")
	command.Flags().BoolVar(&force, "force", false, "Allow overwriting managed files when local modifications are detected")
	return command
}

func newAgentHostValidateSpecCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var forRelease bool

	command := &cobra.Command{
		Use:   "validate-spec",
		Short: "Validate agent-host specification against schema and capability contracts",
		Long: "Validates agent-host.json against schema, backend capability contracts, and\n" +
			"production minimum requirements. When --for-release is passed, additionally\n" +
			"ensures the spec has environment: \"production\" and is suitable for publication.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			specPath = resolveSpecPath(specPath)
			if forRelease {
				// Checked against the raw spec bytes, not the parsed/defaulted struct: an omitted
				// environment field must be rejected here, not silently treated as "production".
				return agenthost.ValidateSpecForReleaseFromPath(specPath, overlayPath)
			}
			spec, err := agenthost.LoadSpecWithOverlay(specPath, overlayPath)
			if err != nil {
				return err
			}
			return agenthost.ValidateBackendContract(spec)
		},
	}
	command.Flags().StringVar(&specPath, "spec", "", "Path to agent-host.json")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().BoolVar(&forRelease, "for-release", false, "Validate that the spec satisfies release gating requirements")
	return command
}

func newAgentHostReleaseCommand() *cobra.Command {
	command := &cobra.Command{
		Use:   "release",
		Short: "Manage Tier 2 control-plane releases (fetch, verify, converge)",
	}
	command.AddCommand(newAgentHostReleaseApplyCommand())
	return command
}

func newAgentHostReleaseApplyCommand() *cobra.Command {
	var specPath string
	var overlayPath string
	var prefix string
	var releasesRoot string
	var baseURL string
	var pubKeyPath string
	var keep int
	var slotCount int
	var dryRun bool
	var diff bool

	command := &cobra.Command{
		Use:   "apply",
		Short: "Fetch, verify, and converge the host to the latest signed Tier 2 release",
		Long: "Fetches the latest signed control-plane release (spec, config, workspace) from\n" +
			"spec.release.manifestBaseURL, verifies its Ed25519 signature before the archive is ever\n" +
			"downloaded, and converges the host to it -- spec/config/packages/systemd via the standard\n" +
			"converger, workspace/ exclusively through the Tier 1 sync-workspace transaction. If already\n" +
			"current, still re-applies to catch host-side drift. On verification failure after apply,\n" +
			"automatically rolls back to the previously-installed generation; if there is none, fails\n" +
			"loudly rather than continuing. --dry-run reports drift without applying or rolling back.\n" +
			"There is no --skip-verify or --force: signature and per-file digest verification cannot be\n" +
			"bypassed.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			specPath = resolveSpecPath(specPath)
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}
			return agenthost.ApplyRelease(context.Background(), agenthost.ApplyReleaseOptions{
				SpecPath:        specPath,
				OverlayPath:     overlayPath,
				Prefix:          prefix,
				ReleasesRoot:    releasesRoot,
				ManifestBaseURL: baseURL,
				PubKeyPath:      pubKeyPath,
				Keep:            keep,
				SlotCount:       slotCount,
				DryRun:          dryRun,
				Diff:            diff,
				CurrentVersion:  cmd.Root().Version,
				Args:            os.Args,
			})
		},
	}
	command.Flags().StringVar(&specPath, "spec", "", "Path to a seed agent-host.json (normally left unset; uses the live spec published by a previous release)")
	command.Flags().StringVar(&overlayPath, "overlay", "", "Path to overlay spec file (e.g. agent-host.dev.json)")
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().StringVar(&releasesRoot, "releases-root", "", "Override releases directory (tests)")
	command.Flags().StringVar(&baseURL, "base-url", "", "Override release manifest base URL (defaults to spec.release.manifestBaseURL)")
	command.Flags().StringVar(&pubKeyPath, "pubkey", "", "Path to Ed25519 verification public key")
	command.Flags().IntVar(&keep, "keep", 0, "Override number of release generations to retain")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	command.Flags().BoolVar(&dryRun, "dry-run", false, "Report drift against the latest release without applying or rolling back")
	command.Flags().BoolVar(&diff, "diff", false, "Print detailed diffs alongside --dry-run")
	return command
}

func newAgentHostRollbackCommand() *cobra.Command {
	var prefix string
	var releasesRoot string
	var to string
	var slotCount int

	command := &cobra.Command{
		Use:   "rollback",
		Short: "Roll back to a previously-installed Tier 2 release generation",
		Long: "Re-applies a previously-installed release generation (defaulting to the one\n" +
			"immediately before the current one) and updates the current pointer. Operates purely on\n" +
			"generations already extracted locally under /var/lib/agent-host/releases; never contacts\n" +
			"the network, so it cannot be blocked by the same connectivity or signing issue that may\n" +
			"have caused the incident.",
		SilenceUsage: true,
		Args:         cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			if prefix == "" {
				prefix = os.Getenv("GDG_SETUP_PREFIX")
			}
			return agenthost.Rollback(context.Background(), agenthost.RollbackOptions{
				ReleasesRoot: releasesRoot,
				Prefix:       prefix,
				To:           to,
				SlotCount:    slotCount,
			})
		},
	}
	command.Flags().StringVar(&prefix, "prefix", "", "Install under this prefix instead of live paths (tests)")
	command.Flags().StringVar(&releasesRoot, "releases-root", "", "Override releases directory (tests)")
	command.Flags().StringVar(&to, "to", "", "Target version to roll back to (defaults to the generation immediately before current)")
	command.Flags().IntVar(&slotCount, "slot-count", 0, "Override spec.slotCount")
	return command
}
