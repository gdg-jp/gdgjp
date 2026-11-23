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
	Rendered    map[string]string `json:"rendered,omitempty"`
	SendersHash string            `json:"sendersHash,omitempty"`
	Manifest    *SourcesManifest  `json:"manifest,omitempty"`
}

type CloneState = State

type ACLSource struct {
	Visibility string  `json:"visibility"`
	ChapterID  *string `json:"chapterId"`
}

const ACLSourcesFileName = "acl-sources.json"

func ACLSourcesPath(root string) string {
	return filepath.Join(ConfigDir(root), ACLSourcesFileName)
}

func WriteACLSources(root string, manifest SourcesManifest) error {
	sources := map[string]ACLSource{}
	if raw, err := os.ReadFile(ACLSourcesPath(root)); err == nil {
		if err := json.Unmarshal(raw, &sources); err != nil {
			return fmt.Errorf("parse %s: %w", ACLSourcesPath(root), err)
		}
	}
	for _, doc := range manifest.Documents {
		if doc.SourceID == nil || *doc.SourceID == "" || doc.Visibility == nil || *doc.Visibility == "" || !doc.ChapterIDPresent {
			continue
		}
		sources[*doc.SourceID] = ACLSource{Visibility: *doc.Visibility, ChapterID: doc.ChapterID}
	}
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(sources, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ACLSourcesPath(root), append(raw, '\n'), 0o644)
}

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
