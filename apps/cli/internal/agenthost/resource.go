// Package agenthost provisions the GDG agent host.
//
// This converger provisions exactly one localhost of exactly one distro.
// No transport, no inventory, no --limit, no loops or conditionals in the spec.
package agenthost

import (
	"context"
	"fmt"
	"strings"
)

// Action represents the mutation required for a resource.
type Action string

const (
	ActionNone   Action = "none"
	ActionCreate Action = "create"
	ActionUpdate Action = "update"
	ActionDelete Action = "delete"
)

// Change encapsulates a planned or applied modification to a resource.
type Change struct {
	ResourceID   string
	ResourceType string
	Action       Action
	Diff         string
	Metadata     map[string]any
}

func (c Change) String() string {
	var b strings.Builder
	fmt.Fprintf(&b, "[%s] %s (%s)", c.Action, c.ResourceID, c.ResourceType)
	if c.Diff != "" {
		fmt.Fprintf(&b, "\n%s", c.Diff)
	}
	return b.String()
}

// Resource represents a single manageable host entity.
type Resource interface {
	ID() string
	ResourceType() string
	Plan(ctx context.Context) (Change, error)
	Apply(ctx context.Context, c Change) error
}
