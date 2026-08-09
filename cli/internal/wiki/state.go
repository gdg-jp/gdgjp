package wiki

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type State struct {
	Ingested   map[string]string `json:"ingested"`
	AgentsHash string            `json:"agentsHash,omitempty"`
}

// CloneState is an alias used by ingest helpers.
type CloneState = State

func StatePath(root string) string {
	return filepath.Join(ConfigDir(root), StateFileName)
}

func statePath(root string) string { return StatePath(root) }

func LoadState(root string) (State, error) {
	raw, err := os.ReadFile(StatePath(root))
	if os.IsNotExist(err) {
		return State{Ingested: map[string]string{}}, nil
	}
	if err != nil {
		return State{}, err
	}
	var state State
	if err = json.Unmarshal(raw, &state); err != nil {
		return State{}, fmt.Errorf("parse %s: %w", StatePath(root), err)
	}
	if state.Ingested == nil {
		state.Ingested = map[string]string{}
	}
	return state, nil
}

func ReadState(root string) (State, error) { return LoadState(root) }

func WriteState(root string, state State) error {
	if state.Ingested == nil {
		state.Ingested = map[string]string{}
	}
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(StatePath(root), append(raw, '\n'), 0o644)
}
