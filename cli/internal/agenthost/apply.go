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
	for i, r := range plan.Resources {
		c := plan.Changes[i]
		if c.Action == ActionNone {
			continue
		}
		if err := r.Apply(ctx, c); err != nil {
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
