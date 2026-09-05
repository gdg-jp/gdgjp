package agenthost

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type BackendSpec struct {
	Name  string `json:"name"`
	Model string `json:"model"`
}

type DiscordSpec struct {
	ShowThinking     bool   `json:"showThinking"`
	Streaming        bool   `json:"streaming"`
	CompletionNotify string `json:"completionNotify"`
}

type CursorAgentPin struct {
	Version string            `json:"version"`
	SHA256  map[string]string `json:"sha256"`
}

type XangiPin struct {
	Repo string `json:"repo"`
	Ref  string `json:"ref"`
}

type GWSPin struct {
	Version string            `json:"version"`
	SHA256  map[string]string `json:"sha256"`
}

type GdgCliPin struct {
	Version       string            `json:"version"`
	AssetTemplate string            `json:"assetTemplate"`
	SHA256        map[string]string `json:"sha256"`
}

type NodePin struct {
	Major    int `json:"major"`
	MinMinor int `json:"minMinor"`
}

type PinsSpec struct {
	CursorAgent CursorAgentPin `json:"cursorAgent"`
	Xangi       XangiPin       `json:"xangi"`
	GWS         GWSPin         `json:"gws"`
	GdgCli      GdgCliPin      `json:"gdgCli"`
	Node        NodePin        `json:"node"`
}

type SystemdSpec struct {
	DropIns map[string]map[string]string `json:"dropIns"`
}

type AgentsIndexSpec struct {
	Enabled bool   `json:"enabled"`
	DataDir string `json:"dataDir"`
	DBPath  string `json:"dbPath"`
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
	VarLibRoot    string
	Spec          SpecFile
}

func loadSpec(path string) (SpecFile, error) {
	return LoadSpecWithOverlay(path, "")
}

func loadSpecWithOverlay(specPath, overlayPath string) (SpecFile, error) {
	return LoadSpecWithOverlay(specPath, overlayPath)
}

func LoadSpecWithOverlay(specPath, overlayPath string) (SpecFile, error) {
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
				return SpecFile{}, fmt.Errorf("spec file not found: %s", specPath)
			}
			return SpecFile{}, err
		}
		baseRaw = raw
		baseOrigin = specPath
	}

	if overlayPath != "" {
		overlayRaw, err := os.ReadFile(overlayPath)
		if err != nil {
			if os.IsNotExist(err) {
				return SpecFile{}, fmt.Errorf("overlay spec file not found: %s", overlayPath)
			}
			return SpecFile{}, err
		}
		merged, err := mergeJSON(baseRaw, overlayRaw)
		if err != nil {
			return SpecFile{}, fmt.Errorf("Failed to parse spec overlay at %s: %w", overlayPath, err)
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

var (
	hex64Regex = regexp.MustCompile(`^[0-9a-f]{64}$`)
	hex40Regex = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

type PathsSpec struct {
	AgentRoot string `json:"agentRoot"`
	Workspace string `json:"workspace"`
	RunRoot   string `json:"runRoot"`
}

type WorkspaceSyncSpec struct {
	Interval string `json:"interval,omitempty"`
	Source   string `json:"source,omitempty"`
}

type SpecFile struct {
	Schema        string             `json:"$schema,omitempty"`
	SlotCount     int                `json:"slotCount"`
	Backend       BackendSpec        `json:"backend"`
	Discord       DiscordSpec        `json:"discord"`
	Pins          PinsSpec           `json:"pins"`
	Paths         PathsSpec          `json:"paths"`
	Systemd       SystemdSpec        `json:"systemd,omitempty"`
	AgentsIndex   AgentsIndexSpec    `json:"agentsIndex,omitempty"`
	WorkspaceSync *WorkspaceSyncSpec `json:"workspaceSync,omitempty"`
}

func parseSpecBytes(raw []byte, origin string) (SpecFile, error) {
	var spec SpecFile
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&spec); err != nil {
		return spec, fmt.Errorf("Failed to parse spec at %s: %w", origin, err)
	}

	if spec.SlotCount < 1 {
		return spec, fmt.Errorf("spec.slotCount must be a positive integer in %s", origin)
	}

	// Validate paths
	for _, p := range []struct {
		name string
		val  string
	}{
		{"agentRoot", spec.Paths.AgentRoot},
		{"workspace", spec.Paths.Workspace},
		{"runRoot", spec.Paths.RunRoot},
	} {
		if strings.TrimSpace(p.val) == "" || !strings.HasPrefix(p.val, "/") {
			return spec, fmt.Errorf("spec.paths must be an object with absolute path starting with / for %s in %s", p.name, origin)
		}
	}

	if spec.Backend.Name != "cursor" {
		return spec, fmt.Errorf("Unsupported backend: %q. Only \"cursor\" is supported at this stage.", spec.Backend.Name)
	}
	if strings.TrimSpace(spec.Backend.Model) == "" {
		return spec, fmt.Errorf("spec.backend.model must be a non-empty string in %s", origin)
	}

	switch spec.Discord.CompletionNotify {
	case "off", "always", "failure":
		// valid
	default:
		return spec, fmt.Errorf("spec.discord.completionNotify must be one of [off, always, failure] in %s (got %q)", origin, spec.Discord.CompletionNotify)
	}

	// Validate cursorAgent pin
	if strings.TrimSpace(spec.Pins.CursorAgent.Version) == "" {
		return spec, fmt.Errorf("spec.pins.cursorAgent.version must be non-empty in %s", origin)
	}
	if !hex64Regex.MatchString(spec.Pins.CursorAgent.SHA256["x86_64"]) || !hex64Regex.MatchString(spec.Pins.CursorAgent.SHA256["aarch64"]) {
		return spec, fmt.Errorf("spec.pins.cursorAgent.sha256 must contain valid 64-hex strings for both x86_64 and aarch64 in %s", origin)
	}

	// Validate xangi pin
	if strings.TrimSpace(spec.Pins.Xangi.Repo) == "" {
		return spec, fmt.Errorf("spec.pins.xangi.repo must be non-empty in %s", origin)
	}
	if !hex40Regex.MatchString(spec.Pins.Xangi.Ref) {
		return spec, fmt.Errorf("spec.pins.xangi.ref must be a 40-character hex commit SHA in %s (got %q)", origin, spec.Pins.Xangi.Ref)
	}

	// Validate gws pin
	if strings.TrimSpace(spec.Pins.GWS.Version) == "" {
		return spec, fmt.Errorf("spec.pins.gws.version must be non-empty in %s", origin)
	}
	if !hex64Regex.MatchString(spec.Pins.GWS.SHA256["x86_64"]) || !hex64Regex.MatchString(spec.Pins.GWS.SHA256["aarch64"]) {
		return spec, fmt.Errorf("spec.pins.gws.sha256 must contain valid 64-hex strings for both x86_64 and aarch64 in %s", origin)
	}

	// Validate gdgCli pin
	if strings.TrimSpace(spec.Pins.GdgCli.Version) == "" {
		return spec, fmt.Errorf("spec.pins.gdgCli.version must be non-empty in %s", origin)
	}
	if strings.TrimSpace(spec.Pins.GdgCli.AssetTemplate) == "" {
		return spec, fmt.Errorf("spec.pins.gdgCli.assetTemplate must be non-empty in %s", origin)
	}
	if !hex64Regex.MatchString(spec.Pins.GdgCli.SHA256["x86_64"]) || !hex64Regex.MatchString(spec.Pins.GdgCli.SHA256["aarch64"]) {
		return spec, fmt.Errorf("spec.pins.gdgCli.sha256 must contain valid 64-hex strings for both x86_64 and aarch64 in %s", origin)
	}

	// Validate node pin
	if spec.Pins.Node.Major < 1 {
		return spec, fmt.Errorf("spec.pins.node.major must be a positive integer in %s", origin)
	}
	if spec.Pins.Node.MinMinor < 0 {
		return spec, fmt.Errorf("spec.pins.node.minMinor must be a non-negative integer in %s", origin)
	}

	// agentsIndex is optional; default the paths when enabled and unset.
	if spec.AgentsIndex.Enabled {
		if strings.TrimSpace(spec.AgentsIndex.DataDir) == "" {
			spec.AgentsIndex.DataDir = "/var/lib/agents-index"
		}
		if !strings.HasPrefix(spec.AgentsIndex.DataDir, "/") {
			return spec, fmt.Errorf("spec.agentsIndex.dataDir must be an absolute path in %s", origin)
		}
		if strings.TrimSpace(spec.AgentsIndex.DBPath) == "" {
			spec.AgentsIndex.DBPath = filepath.Join(spec.AgentsIndex.DataDir, "index.db")
		}
		if !strings.HasPrefix(spec.AgentsIndex.DBPath, "/") {
			return spec, fmt.Errorf("spec.agentsIndex.dbPath must be an absolute path in %s", origin)
		}
	}

	return spec, nil
}

func resolveLayoutPaths(spec SpecFile, prefix string, slotCountOverride int) (layoutPaths, error) {
	paths := layoutPaths{
		SlotCount:     spec.SlotCount,
		SpecAgentRoot: spec.Paths.AgentRoot,
		SpecWikiRoot:  spec.Paths.Workspace,
		SpecRunRoot:   spec.Paths.RunRoot,
		Prefix:        prefix,
		Spec:          spec,
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
	if v := os.Getenv("GDG_SETUP_VAR_LIB_ROOT"); v != "" {
		paths.VarLibRoot = v
	} else {
		paths.VarLibRoot = prefix + "/var/lib/agent-host"
	}
	return paths, nil
}
