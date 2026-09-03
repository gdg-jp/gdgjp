package agenthost

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
	return loadSpecWithOverlay(path, "")
}

func loadSpecWithOverlay(specPath, overlayPath string) (specFile, error) {
	if specPath == "" && overlayPath == "" {
		return parseSpecBytes(defaultSpecJSON, "embedded agent-host.json")
	}

	baseOrigin := "embedded agent-host.json"
	baseRaw := defaultSpecJSON

	if specPath != "" {
		if strings.HasSuffix(specPath, ".dev.json") && overlayPath == "" {
			overlayPath = specPath
			candBase := filepath.Join(filepath.Dir(specPath), "agent-host.json")
			if _, err := os.Stat(candBase); err == nil {
				specPath = candBase
			} else {
				specPath = ""
			}
		}
	}

	if specPath != "" {
		raw, err := os.ReadFile(specPath)
		if err != nil {
			if os.IsNotExist(err) {
				return specFile{}, fmt.Errorf("spec file not found: %s", specPath)
			}
			return specFile{}, err
		}
		baseRaw = raw
		baseOrigin = specPath
	}

	if overlayPath != "" {
		overlayRaw, err := os.ReadFile(overlayPath)
		if err != nil {
			if os.IsNotExist(err) {
				return specFile{}, fmt.Errorf("overlay spec file not found: %s", overlayPath)
			}
			return specFile{}, err
		}
		merged, err := mergeJSON(baseRaw, overlayRaw)
		if err != nil {
			return specFile{}, fmt.Errorf("Failed to parse spec overlay at %s: %w", overlayPath, err)
		}
		return parseSpecBytes(merged, fmt.Sprintf("%s (with overlay %s)", baseOrigin, overlayPath))
	}

	return parseSpecBytes(baseRaw, baseOrigin)
}

func mergeJSON(base, overlay []byte) ([]byte, error) {
	var baseMap map[string]any
	if err := json.Unmarshal(base, &baseMap); err != nil {
		return nil, err
	}
	var overlayMap map[string]any
	if err := json.Unmarshal(overlay, &overlayMap); err != nil {
		return nil, err
	}
	deepMergeMaps(baseMap, overlayMap)
	return json.Marshal(baseMap)
}

func deepMergeMaps(dst, src map[string]any) {
	for k, v := range src {
		srcMap, srcIsMap := v.(map[string]any)
		dstMap, dstIsMap := dst[k].(map[string]any)
		if srcIsMap && dstIsMap {
			deepMergeMaps(dstMap, srcMap)
		} else {
			dst[k] = v
		}
	}
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
