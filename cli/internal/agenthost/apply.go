package agenthost

import (
	"context"
	"errors"
	"fmt"
	"os"
)

// ErrDriftDetected is returned by dry-run when host configuration has drifted from spec.
var ErrDriftDetected = errors.New("drift detected")

// ErrNeedRoot is returned when live path operations are attempted without root privileges.
var ErrNeedRoot = errors.New("agent-host operations on live paths require root privileges (run with sudo or pass --prefix)")

// ApplyOptions controls plan execution.
type ApplyOptions struct {
	DryRun bool
	Diff   bool
}

// ApplyPlan executes the plan or reports drift in dry-run mode.
func ApplyPlan(ctx context.Context, plan *Plan, opts ApplyOptions) error {
	if plan.Paths.Prefix == "" && os.Getuid() != 0 {
		return ErrNeedRoot
	}

	if opts.Diff {
		if diff := plan.DiffSummary(); diff != "" {
			fmt.Println(diff)
		}
	}

	if opts.DryRun {
		if plan.HasChanges() {
			return fmt.Errorf("%w: %d pending changes", ErrDriftDetected, plan.ChangeCount())
		}
		fmt.Println("No changes. Host is converged.")
		return nil
	}

	applied := 0
	var execResources []Resource
	var systemdResources []Resource

	// Phase 1: Prerequisites, Users, Tarballs, Directories, Files, Git, Wiki, AppArmor
	for i, r := range plan.Resources {
		switch r.ResourceType() {
		case "exec":
			execResources = append(execResources, r)
			continue
		case "systemd":
			systemdResources = append(systemdResources, r)
			continue
		}

		c := plan.Changes[i]
		if c.Action == ActionNone {
			continue
		}
		if err := r.Apply(ctx, c); err != nil {
			return fmt.Errorf("failed to apply %s (%s): %w", r.ID(), r.ResourceType(), err)
		}
		applied++
	}

	// Phase 2: Re-evaluate and apply ExecResources
	// Now that Phase 1 has completed (Git clones and file writes are in place),
	// re-plan each exec resource against the live disk state to ensure package-lock.json changes are captured.
	for _, r := range execResources {
		freshChange, err := r.Plan(ctx)
		if err != nil {
			return fmt.Errorf("planning %s failed: %w", r.ID(), err)
		}
		if freshChange.Action == ActionNone {
			continue
		}
		if err := r.Apply(ctx, freshChange); err != nil {
			return fmt.Errorf("failed to apply %s (%s): %w", r.ID(), r.ResourceType(), err)
		}
		applied++
	}

	// Phase 3: Systemd unit resources and handlers
	for _, r := range systemdResources {
		var targetChange Change
		for i, orig := range plan.Resources {
			if orig == r {
				targetChange = plan.Changes[i]
				break
			}
		}
		if targetChange.Action == ActionNone {
			continue
		}
		if err := r.Apply(ctx, targetChange); err != nil {
			return fmt.Errorf("failed to apply %s (%s): %w", r.ID(), r.ResourceType(), err)
		}
		applied++
	}

	if applied == 0 {
		fmt.Println("No changes. Host is converged.")
	} else {
		fmt.Printf("Converged %d changes across host resources under %s\n", applied, plan.Paths.AgentRoot)
	}

	return nil
}
