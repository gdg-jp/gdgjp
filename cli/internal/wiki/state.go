package wiki

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type State struct {
	Ingested    map[string]string `json:"ingested"`
	AgentsHash  string            `json:"agentsHash,omitempty"`
	Rendered    map[string]string `json:"rendered,omitempty"`    // documentID -> post-replace digest
	SendersHash string            `json:"sendersHash,omitempty"` // digest of sender map
	// Manifest is the last complete raw pull snapshot. A missing ChapterID in a
	// legacy entry remains unresolved; consumers must fail closed rather than
	// treating it as an all-chapters source. Ingest deliberately uses
	// this local snapshot so queue generation and completion do not call Wiki.
	Manifest *SourcesManifest `json:"manifest,omitempty"`
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
		return State{Ingested: map[string]string{}, Rendered: map[string]string{}}, nil
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
	if state.Rendered == nil {
		state.Rendered = map[string]string{}
	}
	return state, nil
}

func ReadState(root string) (State, error) { return LoadState(root) }

func WriteState(root string, state State) error {
	if state.Ingested == nil {
		state.Ingested = map[string]string{}
	}
	if state.Rendered == nil {
		state.Rendered = map[string]string{}
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
