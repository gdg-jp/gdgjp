package agenthost

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type specFile struct {
	SlotCount int `json:"slotCount"`
	Paths     struct {
		AgentRoot string `json:"agentRoot"`
		Workspace string `json:"workspace"`
		RunRoot   string `json:"runRoot"`
	} `json:"paths"`
}

type layoutPaths struct {
	SlotCount     int
	SpecAgentRoot string
	SpecWikiRoot  string
	SpecRunRoot   string
	Prefix        string
	AgentRoot     string
	WikiRoot      string
	RunRoot       string
	EtcRoot       string
	HomeRoot      string
}

func loadSpec(path string) (specFile, error) {
	if path == "" {
		return parseSpecBytes(defaultSpecJSON, "embedded agent-host.json")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return specFile{}, fmt.Errorf("spec file not found: %s", path)
		}
		return specFile{}, err
	}
	return parseSpecBytes(raw, path)
}

func parseSpecBytes(raw []byte, origin string) (specFile, error) {
	var spec specFile
	var tree map[string]json.RawMessage
	if err := json.Unmarshal(raw, &tree); err != nil {
		return spec, fmt.Errorf("Failed to parse spec at %s: %s", origin, err.Error())
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		return spec, fmt.Errorf("Failed to parse spec at %s: %s", origin, err.Error())
	}
	if spec.SlotCount < 1 {
		return spec, fmt.Errorf("spec.slotCount must be a positive integer in %s", origin)
	}
	pathsRaw, ok := tree["paths"]
	if !ok || !json.Valid(pathsRaw) || strings.TrimSpace(string(pathsRaw)) == "null" {
		return spec, fmt.Errorf("spec.paths must be an object in %s", origin)
	}
	var pathsObj map[string]any
	if err := json.Unmarshal(pathsRaw, &pathsObj); err != nil || pathsObj == nil {
		return spec, fmt.Errorf("spec.paths must be an object in %s", origin)
	}
	for _, key := range []string{"agentRoot", "workspace", "runRoot"} {
		value, exists := pathsObj[key]
		text, isString := value.(string)
		if !exists || !isString || strings.TrimSpace(text) == "" {
			return spec, fmt.Errorf("spec.paths.%s must be a non-empty string in %s", key, origin)
		}
	}
	return spec, nil
}

func resolveLayoutPaths(spec specFile, prefix string, slotCountOverride int) (layoutPaths, error) {
	paths := layoutPaths{
		SlotCount:     spec.SlotCount,
		SpecAgentRoot: spec.Paths.AgentRoot,
		SpecWikiRoot:  spec.Paths.Workspace,
		SpecRunRoot:   spec.Paths.RunRoot,
		Prefix:        prefix,
	}
	if slotCountOverride > 0 {
		paths.SlotCount = slotCountOverride
	} else if env := os.Getenv("GDG_AGENT_SLOT_COUNT"); env != "" {
		n, err := strconv.Atoi(env)
		if err != nil || n < 1 {
			return paths, fmt.Errorf("GDG_AGENT_SLOT_COUNT must be a positive integer")
		}
		paths.SlotCount = n
	}
	if paths.SlotCount < 1 {
		return paths, fmt.Errorf("GDG_AGENT_SLOT_COUNT must be a positive integer")
	}
	if v := os.Getenv("GDG_SETUP_AGENT_ROOT"); v != "" {
		paths.AgentRoot = v
	} else {
		paths.AgentRoot = prefix + spec.Paths.AgentRoot
	}
	if v := os.Getenv("GDG_SETUP_WIKI_ROOT"); v != "" {
		paths.WikiRoot = v
	} else {
		paths.WikiRoot = prefix + spec.Paths.Workspace
	}
	if v := os.Getenv("GDG_SETUP_RUN_ROOT"); v != "" {
		paths.RunRoot = v
	} else {
		paths.RunRoot = prefix + spec.Paths.RunRoot
	}
	if v := os.Getenv("GDG_SETUP_ETC_ROOT"); v != "" {
		paths.EtcRoot = v
	} else {
		paths.EtcRoot = prefix + "/etc"
	}
	if v := os.Getenv("GDG_SETUP_HOME_ROOT"); v != "" {
		paths.HomeRoot = v
	} else {
		paths.HomeRoot = prefix + "/home"
	}
	return paths, nil
}
