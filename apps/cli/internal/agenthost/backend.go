package agenthost

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// IsolationSpec declares the security boundaries required by the spec.
type IsolationSpec struct {
	SlotLauncher bool   `json:"slotLauncher"`
	OSSandbox    string `json:"osSandbox"`
	ToolGate     string `json:"toolGate"`
}

// BackendCapabilities defines the security boundaries actually provided by an agent backend.
type BackendCapabilities struct {
	SlotLauncher bool
	OSSandbox    string // "workspace" | "none"
	ToolGate     string // "preToolUse-failClosed" | "none"
	PolicyBundle string // Directory under config/backends/<name>
}

// BackendPolicy defines the interface that each backend implementation must satisfy.
// It encapsulates capabilities, bundle validation, and backend-specific host/slot resource generation.
type BackendPolicy interface {
	Name() string
	Capabilities() BackendCapabilities
	ValidateBundleInvariants(iso IsolationSpec) error
	BuildHostResources(paths layoutPaths) ([]Resource, error)
	BuildSlotDirectories(paths layoutPaths, slot int) ([]Resource, error)
	BuildSlotResources(paths layoutPaths, slot int, slotRunDir, indexSocket string) ([]Resource, error)
}

var backendPolicies = map[string]BackendPolicy{
	"cursor":      &cursorPolicy{},
	"antigravity": &antigravityPolicy{},
}

// productionMinimum defines the non-negotiable security baseline for production hosts.
// It is compiled into the binary and cannot be relaxed by spec files or release artifacts.
var productionMinimum = IsolationSpec{
	SlotLauncher: true,
	OSSandbox:    "workspace",
	ToolGate:     "preToolUse-failClosed",
}

var approvedGdgCliDigests = map[string]bool{
	// v0.4.4
	"329eb234a741c8d2db56f30c7847255fb287551276d8589768c87b29a53f30c8": true, // x86_64
	"57d13f222357e1ee9eefec4fc9f3f3c70c293952c864aa5871bc1f135ecb3881": true, // aarch64
	// v0.4.3
	"46d9c3aca195897b1a6631abba6beb0520f553f5a715d385ec23fbad18b8149d": true, // x86_64
	"a4b02f07ffc72f75308d818c7ddfdc3d87cf4d2e7955f9e9f66e5a28930a95b4": true, // aarch64
	// v0.4.1
	"32430a137e8e394c073a73b8f7aecb2e6f9fddb9f3beba9e69c0d1118683beaa": true, // x86_64
	"23b421423a3d9ec0454b0f47023003497ebc2e670fe3391b55134a0c68777fd4": true, // aarch64
	// v0.4.0
	"9235020b3516695bef999feea00745dd0542c932eb93a7c01fff684070de2fb1": true, // x86_64
	"1d4513e571794b6b9843852ffd64d2c7f0087757e6597611eb0e97e3fe778fef": true, // aarch64
	// v0.3.1
	"521302e1837bb5023b2574c03e59db4f9a7e6cb9a28f55fc70b42660768fdc53": true, // x86_64
	"87b641f470f74d1ac3c6324500197ceb51f2807e5773723a47a38ca76444030b": true, // aarch64
	// v0.1.4
	"0d8affab878ab1ba9c7f8df9efae1a47964db9bfb356592d7ee43a23ec14be3b": true, // x86_64
	"5dbf544d0cf9ed34cce688fbb6e40fc1e5cbc3719ff50a2a1e62438729bb07a0": true, // aarch64
}

// GetBackendPolicy returns the policy implementation for a named backend or error if unknown.
func GetBackendPolicy(name string) (BackendPolicy, error) {
	policy, ok := backendPolicies[name]
	if !ok {
		return nil, fmt.Errorf("error: unknown backend %q", name)
	}
	return policy, nil
}

// GetBackendCapabilities returns the capabilities for a named backend or false if unknown.
func GetBackendCapabilities(name string) (BackendCapabilities, bool) {
	policy, ok := backendPolicies[name]
	if !ok {
		return BackendCapabilities{}, false
	}
	return policy.Capabilities(), true
}

// GetProductionMinimum returns the compiled-in production minimum isolation requirements.
func GetProductionMinimum() IsolationSpec {
	return productionMinimum
}

// IsApprovedGdgCliDigest checks whether a sha256 checksum belongs to an approved release of gdg CLI.
func IsApprovedGdgCliDigest(digest string) bool {
	return approvedGdgCliDigests[strings.ToLower(strings.TrimSpace(digest))]
}

// ValidateIsolationValues verifies that isolation enum fields contain valid identifiers.
func ValidateIsolationValues(iso IsolationSpec) error {
	switch iso.OSSandbox {
	case "workspace", "none":
		// valid
	default:
		return fmt.Errorf("osSandbox must be one of [workspace, none] (got %q)", iso.OSSandbox)
	}

	switch iso.ToolGate {
	case "preToolUse-failClosed", "none":
		// valid
	default:
		return fmt.Errorf("toolGate must be one of [preToolUse-failClosed, none] (got %q)", iso.ToolGate)
	}
	return nil
}

// ValidateBackendContract enforces that the selected backend satisfies the isolation contract,
// respects the production minimum when running in production, and satisfies policy bundle invariants.
func ValidateBackendContract(spec SpecFile) error {
	policy, err := GetBackendPolicy(spec.Backend.Name)
	if err != nil {
		return err
	}
	caps := policy.Capabilities()

	// 1. Verify backend capabilities against requested isolation.
	var failures []string
	if spec.Backend.Isolation.SlotLauncher && !caps.SlotLauncher {
		failures = append(failures, fmt.Sprintf("  slotLauncher: required true, but %s provides false", spec.Backend.Name))
	}
	if spec.Backend.Isolation.OSSandbox == "workspace" && caps.OSSandbox != "workspace" {
		failures = append(failures, fmt.Sprintf("  osSandbox:    required %q, but %s provides %q", spec.Backend.Isolation.OSSandbox, spec.Backend.Name, caps.OSSandbox))
	}
	if spec.Backend.Isolation.ToolGate == "preToolUse-failClosed" && caps.ToolGate != "preToolUse-failClosed" {
		failures = append(failures, fmt.Sprintf("  toolGate:     required %q, but %s provides %q", spec.Backend.Isolation.ToolGate, spec.Backend.Name, caps.ToolGate))
	}

	if len(failures) > 0 {
		return fmt.Errorf("error: backend %q does not satisfy required isolation\n%s", spec.Backend.Name, strings.Join(failures, "\n"))
	}

	// 2. Verify production minimum if in production environment.
	env := spec.Environment
	if env == "" {
		env = "production"
	}
	if env == "production" {
		if err := ValidateProductionMinimum(env, spec.Backend.Isolation); err != nil {
			return err
		}
	}

	// 3. Verify backend bundle invariants via the policy implementation.
	if err := policy.ValidateBundleInvariants(spec.Backend.Isolation); err != nil {
		return err
	}

	return nil
}

// ValidateBackendBundleInvariants delegates bundle invariant validation to the specified backend policy.
func ValidateBackendBundleInvariants(name string, iso IsolationSpec) error {
	policy, err := GetBackendPolicy(name)
	if err != nil {
		return err
	}
	return policy.ValidateBundleInvariants(iso)
}

// ValidateProductionMinimum ensures that the requested isolation meets the compiled-in production minimum.
func ValidateProductionMinimum(env string, iso IsolationSpec) error {
	var violations []string
	if !iso.SlotLauncher && productionMinimum.SlotLauncher {
		violations = append(violations, "  slotLauncher: required true, got false")
	}
	if iso.OSSandbox != productionMinimum.OSSandbox {
		violations = append(violations, fmt.Sprintf("  osSandbox:    required %q, got %q", productionMinimum.OSSandbox, iso.OSSandbox))
	}
	if iso.ToolGate != productionMinimum.ToolGate {
		violations = append(violations, fmt.Sprintf("  toolGate:     required %q, got %q", productionMinimum.ToolGate, iso.ToolGate))
	}

	if len(violations) > 0 {
		return fmt.Errorf("error: backend.isolation does not satisfy production minimum requirements for environment %q\n%s", env, strings.Join(violations, "\n"))
	}
	return nil
}

// ValidateSudoersSlotLauncher verifies that generated sudoers contains explicit launcher entries for all slots.
// It skips comments and requires exact matches for the expected run-as user and launcher binary path.
func ValidateSudoersSlotLauncher(sudoersContent string, slotCount int) error {
	if strings.ContainsAny(sudoersContent, "*?") {
		return errors.New("sudoers invariant violation: wildcards (* or ?) are forbidden")
	}

	var activeRules []string
	for _, line := range strings.Split(sudoersContent, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		activeRules = append(activeRules, trimmed)
	}

	for slot := 0; slot < slotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		launcherBin := fmt.Sprintf("spawn-slot-%d", slot)
		found := false
		pattern := regexp.MustCompile(fmt.Sprintf(`^gdgagent-svc\s+ALL\s*=\s*\(%s\)\s+NOPASSWD:\s+\S*\/bin\/%s$`, regexp.QuoteMeta(slotUser), regexp.QuoteMeta(launcherBin)))
		for _, rule := range activeRules {
			if pattern.MatchString(rule) {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("sudoers invariant violation: missing valid launcher rule for slot %d (expected user %s and binary %s)", slot, slotUser, launcherBin)
		}
	}
	return nil
}

// ValidateSpecForRelease blocks specs with environment "development" from being published.
func ValidateSpecForRelease(spec SpecFile) error {
	env := spec.Environment
	if env == "" {
		env = "production"
	}
	if env == "development" {
		return errors.New("spec with environment \"development\" cannot be published to production release")
	}
	return ValidateBackendContract(spec)
}

// ValidateSpecForReleaseFromPath is like ValidateSpecForRelease, but additionally rejects a spec
// whose "environment" field is omitted from the raw JSON, rather than accepting the silent default
// to "production" that ordinary spec loading (LoadSpecWithOverlay/parseSpecBytes) applies
// elsewhere. This must be checked against the raw bytes: by the time a SpecFile struct exists,
// an omitted field and an explicit "production" are indistinguishable, and the whole point of this
// release-boundary gate is to catch a spec that forgot to declare itself production before it gets
// published as one (see Stage 10's design constraint that an omitted environment must not
// silently pass release validation).
func ValidateSpecForReleaseFromPath(specPath, overlayPath string) error {
	baseRaw := defaultSpecJSON
	if specPath != "" {
		raw, err := os.ReadFile(specPath)
		if err != nil {
			return fmt.Errorf("read spec %s: %w", specPath, err)
		}
		baseRaw = raw
	}

	effectiveRaw := baseRaw
	if overlayPath != "" {
		overlayRaw, err := os.ReadFile(overlayPath)
		if err != nil {
			return fmt.Errorf("read overlay %s: %w", overlayPath, err)
		}
		merged, err := mergeJSON(baseRaw, overlayRaw)
		if err != nil {
			return err
		}
		effectiveRaw = merged
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(effectiveRaw, &raw); err != nil {
		return fmt.Errorf("parse spec: %w", err)
	}
	if _, ok := raw["environment"]; !ok {
		return errors.New(`spec.environment is required for release (omission is not accepted; the spec must explicitly declare "production" or "development")`)
	}

	spec, err := LoadSpecWithOverlay(specPath, overlayPath)
	if err != nil {
		return err
	}
	return ValidateSpecForRelease(spec)
}

// --- Cursor Policy Implementation ---

type cursorPolicy struct{}

func (c *cursorPolicy) Name() string { return "cursor" }

func (c *cursorPolicy) Capabilities() BackendCapabilities {
	return BackendCapabilities{
		SlotLauncher: true,
		OSSandbox:    "workspace",
		ToolGate:     "preToolUse-failClosed",
		PolicyBundle: "cursor",
	}
}

func (c *cursorPolicy) ValidateBundleInvariants(iso IsolationSpec) error {
	bundleDir := c.Capabilities().PolicyBundle

	// ToolGate invariant: hooks.preToolUse[0].failClosed must be true
	if iso.ToolGate == "preToolUse-failClosed" {
		hooksBytes, err := backendConfigBytes(bundleDir, "hooks.json")
		if err != nil {
			return fmt.Errorf("failed to read cursor hooks.json: %w", err)
		}
		var hooksData struct {
			Hooks struct {
				PreToolUse []struct {
					Command    string `json:"command"`
					FailClosed bool   `json:"failClosed"`
				} `json:"preToolUse"`
			} `json:"hooks"`
		}
		if err := json.Unmarshal(hooksBytes, &hooksData); err != nil {
			return fmt.Errorf("failed to parse cursor hooks.json: %w", err)
		}
		if len(hooksData.Hooks.PreToolUse) == 0 || !hooksData.Hooks.PreToolUse[0].FailClosed {
			return errors.New("backend bundle violation: hooks.preToolUse[0].failClosed must be true when toolGate is preToolUse-failClosed")
		}
	}

	// OSSandbox invariant: cli-config.json sandbox.mode == "enabled" && readBoundary == "workspace"
	if iso.OSSandbox == "workspace" {
		cliCfgBytes, err := backendConfigBytes(bundleDir, "cli-config.json")
		if err != nil {
			return fmt.Errorf("failed to read cursor cli-config.json: %w", err)
		}
		var cliCfg struct {
			Sandbox struct {
				Mode         string `json:"mode"`
				ReadBoundary string `json:"readBoundary"`
			} `json:"sandbox"`
		}
		if err := json.Unmarshal(cliCfgBytes, &cliCfg); err != nil {
			return fmt.Errorf("failed to parse cursor cli-config.json: %w", err)
		}
		if cliCfg.Sandbox.Mode != "enabled" || cliCfg.Sandbox.ReadBoundary != "workspace" {
			return errors.New("backend bundle violation: sandbox.mode must be \"enabled\" and readBoundary must be \"workspace\" when osSandbox is workspace")
		}

		// sandbox.json.in invariants:
		sandboxBytes, err := backendConfigBytes(bundleDir, "sandbox.json.in")
		if err != nil {
			return fmt.Errorf("failed to read cursor sandbox.json.in: %w", err)
		}
		var sandboxData struct {
			AdditionalReadonlyPaths []string `json:"additionalReadonlyPaths"`
		}
		if err := json.Unmarshal(sandboxBytes, &sandboxData); err != nil {
			return fmt.Errorf("failed to parse cursor sandbox.json.in: %w", err)
		}

		rawStr := string(sandboxBytes)
		if strings.Contains(rawStr, ".config/gdg") || strings.Contains(rawStr, ".config/xangi") {
			return errors.New("backend bundle violation: sandbox.json.in must not reference .config/gdg or .config/xangi")
		}

		if err := ValidateSandboxReadonlyPaths(sandboxData.AdditionalReadonlyPaths); err != nil {
			return err
		}
	}

	return nil
}

// ValidateSandboxReadonlyPaths checks that additionalReadonlyPaths adheres to canonicalization and isolation rules.
// Parent /run/gdg-agent must not be exposed directly or via relative traversals (e.g. /run/gdg-agent/., /run/gdg-agent/0/..),
// traversals with ".." are forbidden, and __RUN_SLOT_DIR__ must be present.
func ValidateSandboxReadonlyPaths(paths []string) error {
	hasSlotPlaceholder := false
	for _, p := range paths {
		cleaned := filepath.Clean(p)
		if cleaned == "/run/gdg-agent" {
			return errors.New("backend bundle violation: sandbox.json.in additionalReadonlyPaths must not include parent /run/gdg-agent")
		}
		if strings.Contains(p, "..") || strings.Contains(cleaned, "..") {
			return errors.New("backend bundle violation: sandbox.json.in additionalReadonlyPaths must not contain relative traversal (..)")
		}
		simulated := filepath.Clean(strings.ReplaceAll(p, "__RUN_SLOT_DIR__", "/run/gdg-agent/0"))
		if simulated == "/run/gdg-agent" {
			return errors.New("backend bundle violation: sandbox.json.in additionalReadonlyPaths must not include parent /run/gdg-agent")
		}
		if cleaned == "__RUN_SLOT_DIR__" || strings.HasPrefix(cleaned, "__RUN_SLOT_DIR__/") {
			hasSlotPlaceholder = true
		}
	}
	if !hasSlotPlaceholder {
		return errors.New("backend bundle violation: sandbox.json.in additionalReadonlyPaths must contain __RUN_SLOT_DIR__")
	}
	return nil
}

func (c *cursorPolicy) BuildHostResources(paths layoutPaths) ([]Resource, error) {
	var res []Resource
	bundleDir := c.Capabilities().PolicyBundle

	cliConfigTemplate, err := backendConfigBytes(bundleDir, "cli-config.json")
	if err != nil {
		return nil, err
	}
	cliConfigCanonical := []byte(subst(string(cliConfigTemplate), paths.SpecAgentRoot, "", ""))
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "lib", "cli-config.json"),
		Data:  cliConfigCanonical,
		Mode:  0o444,
		Owner: "root",
		Group: "root",
	})

	if paths.Spec.Backend.Isolation.OSSandbox == "workspace" {
		apparmorData, err := configBytes("apparmor.d-cursor-agent-cursorsandbox")
		if err != nil {
			return nil, err
		}
		res = append(res, &AppArmorResource{
			Path:   filepath.Join(paths.EtcRoot, "apparmor.d", "cursor-agent-cursorsandbox"),
			Data:   apparmorData,
			Prefix: paths.Prefix,
		})
	}

	return res, nil
}

func (c *cursorPolicy) BuildSlotDirectories(paths layoutPaths, slot int) ([]Resource, error) {
	slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
	slotHome := filepath.Join(paths.HomeRoot, slotUser)
	return []Resource{
		&DirResource{
			Path:  filepath.Join(slotHome, ".cursor"),
			Mode:  unixFileMode(0o1775),
			Owner: "root",
			Group: slotUser,
		},
		&DirResource{
			Path:  filepath.Join(slotHome, ".cursor", "projects"),
			Mode:  0o755,
			Owner: slotUser,
			Group: slotUser,
		},
	}, nil
}

func (c *cursorPolicy) BuildSlotResources(paths layoutPaths, slot int, slotRunDir, indexSocket string) ([]Resource, error) {
	slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
	slotHome := filepath.Join(paths.HomeRoot, slotUser)
	cursorDir := filepath.Join(slotHome, ".cursor")
	bundleDir := c.Capabilities().PolicyBundle

	hooksTemplate, err := backendConfigBytes(bundleDir, "hooks.json")
	if err != nil {
		return nil, err
	}
	cliConfigTemplate, err := backendConfigBytes(bundleDir, "cli-config.json")
	if err != nil {
		return nil, err
	}
	sandboxTemplate, err := backendConfigBytes(bundleDir, "sandbox.json.in")
	if err != nil {
		return nil, err
	}
	mcpTemplate, err := backendConfigBytes(bundleDir, "mcp.json.in")
	if err != nil {
		return nil, err
	}
	extraMCP, err := configBytes("extra-mcp.json")
	if err != nil {
		return nil, err
	}
	permissions, err := backendConfigBytes(bundleDir, "permissions.json")
	if err != nil {
		return nil, err
	}

	mergedMCP, mcpErr := mergeSlotMCP([]byte(subst(string(mcpTemplate), paths.SpecAgentRoot, "", indexSocket)), extraMCP)
	if mcpErr != nil {
		return nil, mcpErr
	}

	return []Resource{
		&FileResource{
			Path:  filepath.Join(cursorDir, "hooks.json"),
			Data:  []byte(subst(string(hooksTemplate), paths.SpecAgentRoot, "", "")),
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
		&FileResource{
			Path:  filepath.Join(cursorDir, "cli-config.json"),
			Data:  []byte(subst(string(cliConfigTemplate), paths.SpecAgentRoot, "", "")),
			Mode:  0o644,
			Owner: slotUser,
			Group: slotUser,
		},
		&FileResource{
			Path:  filepath.Join(cursorDir, "sandbox.json"),
			Data:  []byte(subst(string(sandboxTemplate), paths.SpecAgentRoot, slotRunDir, "")),
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
		&FileResource{
			Path:  filepath.Join(cursorDir, "mcp.json"),
			Data:  mergedMCP,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
		&FileResource{
			Path:  filepath.Join(cursorDir, "permissions.json"),
			Data:  permissions,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
	}, nil
}

// --- Antigravity Policy Implementation ---

type antigravityPolicy struct{}

func (a *antigravityPolicy) Name() string { return "antigravity" }

func (a *antigravityPolicy) Capabilities() BackendCapabilities {
	return BackendCapabilities{
		SlotLauncher: true, // Stage 12: CliRunnerBase now sudo-execs spawn-slot-<N> for all adapters
		// Stage 14 (ADR-032): agy's --sandbox / enableTerminalSandbox exists, but its read
		// boundary was not verified equivalent to Cursor's readBoundary: workspace. Recording
		// this as anything but "none" without that proof would be exactly the registry lie
		// Stage 11 forbids, so it stays false until a VM-based boundary test confirms it.
		OSSandbox: "none",
		// Stage 14 (ADR-032, and its code-review follow-up): the mechanism is implemented
		// below (acl-gate.ts reused via a root-owned per-slot hooks.json, a hard
		// decision:"deny" in agy's documented PreToolUse contract) and end-to-end tested
		// against the unpinned agy 1.1.3 available during development. It still stays
		// "none" here: the registry must not claim a stronger guarantee than a pinned,
		// checksummed release actually provides, and no agy version is pinned yet
		// (docs/agents-local-mvp/adr.md ADR-032 residual tasks). Flip this only after
		// pins.antigravity is set to a real version+sha256 and an agy-driven E2E deny
		// test passes against that exact pinned binary.
		ToolGate:     "none",
		PolicyBundle: "antigravity",
	}
}

func (a *antigravityPolicy) ValidateBundleInvariants(iso IsolationSpec) error {
	bundleDir := a.Capabilities().PolicyBundle

	if iso.ToolGate == "preToolUse-failClosed" {
		permBytes, err := backendConfigBytes(bundleDir, "permissions.json")
		if err != nil {
			return fmt.Errorf("failed to read antigravity permissions.json: %w", err)
		}
		var permData struct {
			GwsAllowlist []string `json:"gwsAllowlist"`
		}
		if err := json.Unmarshal(permBytes, &permData); err != nil {
			return fmt.Errorf("failed to parse antigravity permissions.json: %w", err)
		}

		if err := validateAntigravityHooksBundle(bundleDir); err != nil {
			return err
		}

		if err := validateAntigravitySettingsBundle(bundleDir); err != nil {
			return err
		}
	}

	return nil
}

// validateAntigravitySettingsBundle checks settings.json (agy's own native config, deployed to
// ~/.gemini/antigravity-cli/settings.json) grants the "command" permission for wk and gws.
//
// This is a second, independent gate discovered empirically (ADR-032 E2E test): agy's headless
// mode auto-denies any "command"-type tool call that lacks a matching permissions.allow entry,
// regardless of what the PreToolUse hook decides — the hook returning decision:"allow" for a wk
// invocation is not sufficient on its own for the call to actually run in production. Without
// this, the toolGate mechanism would fail safe but be unusable: wk/gws would never execute.
func validateAntigravitySettingsBundle(bundleDir string) error {
	settingsBytes, err := backendConfigBytes(bundleDir, "settings.json")
	if err != nil {
		return fmt.Errorf("failed to read antigravity settings.json: %w", err)
	}
	var settingsData struct {
		Permissions struct {
			Allow []string `json:"allow"`
		} `json:"permissions"`
	}
	if err := json.Unmarshal(settingsBytes, &settingsData); err != nil {
		return fmt.Errorf("failed to parse antigravity settings.json: %w", err)
	}
	for _, want := range []string{"command(wk)", "command(gws)"} {
		if !slices.Contains(settingsData.Permissions.Allow, want) {
			return fmt.Errorf(
				"backend bundle violation: settings.json permissions.allow must contain %q",
				want,
			)
		}
	}
	return nil
}

// antigravityHooksFile mirrors the shape documented for agy's hooks.json (see ADR-032):
// a map of hook-name to event lists, PreToolUse entries grouped by matcher+hooks.
type antigravityHooksFile map[string]struct {
	PreToolUse []struct {
		Matcher string `json:"matcher"`
		Hooks   []struct {
			Type    string `json:"type"`
			Command string `json:"command"`
			Timeout int    `json:"timeout"`
		} `json:"hooks"`
	} `json:"PreToolUse"`
}

// validateAntigravityHooksBundle checks the structural invariants a hostile edit could break
// silently. The command is intentionally exact: accepting substrings would allow a shell prefix,
// suffix, or reordered environment assignment to satisfy validation without executing the gate
// under the intended policy.
func validateAntigravityHooksBundle(bundleDir string) error {
	hooksBytes, err := backendConfigBytes(bundleDir, "hooks.json")
	if err != nil {
		return fmt.Errorf("failed to read antigravity hooks.json: %w", err)
	}
	var hooksData antigravityHooksFile
	if err := json.Unmarshal(hooksBytes, &hooksData); err != nil {
		return fmt.Errorf("failed to parse antigravity hooks.json: %w", err)
	}

	for name, hook := range hooksData {
		for _, entry := range hook.PreToolUse {
			if entry.Matcher != "*" {
				continue
			}
			for _, h := range entry.Hooks {
				if h.Type != "command" {
					continue
				}
				wantCommand := strings.Join([]string{
					"ACL_GATE_BACKEND=antigravity",
					"GDG_GWS_ALLOWLIST_PATH=/opt/gdg-agent/lib/antigravity-permissions.json",
					"/usr/bin/node",
					"/opt/gdg-agent/lib/acl-gate.ts",
					"/opt/gdg-agent/bin/wk",
					"/opt/gdg-agent/bin/gws",
				}, " ")
				if h.Command != wantCommand {
					continue
				}
				if h.Timeout <= 0 {
					return fmt.Errorf(
						"backend bundle violation: hooks.json entry %q must set a positive timeout",
						name,
					)
				}
				return nil
			}
		}
	}
	return errors.New(
		"backend bundle violation: hooks.json must contain a PreToolUse command hook matching \"*\" with the exact Antigravity acl-gate command",
	)
}

func (a *antigravityPolicy) BuildHostResources(paths layoutPaths) ([]Resource, error) {
	var res []Resource
	bundleDir := a.Capabilities().PolicyBundle

	if paths.Spec.Backend.Isolation.ToolGate == "preToolUse-failClosed" {
		permissions, err := backendConfigBytes(bundleDir, "permissions.json")
		if err != nil {
			return nil, err
		}
		// Host-wide, not per-slot: every slot's hooks.json (below) points at the same
		// fixed path via GDG_GWS_ALLOWLIST_PATH, so one shared, root-owned copy suffices —
		// this leaves Cursor's per-slot ~/.cursor/permissions.json (and its default
		// lookup path) untouched.
		res = append(res, &FileResource{
			Path:  filepath.Join(paths.AgentRoot, "lib", "antigravity-permissions.json"),
			Data:  permissions,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
	}

	return res, nil
}

func (a *antigravityPolicy) BuildSlotDirectories(paths layoutPaths, slot int) ([]Resource, error) {
	if paths.Spec.Backend.Isolation.ToolGate != "preToolUse-failClosed" {
		return nil, nil
	}
	slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
	slotHome := filepath.Join(paths.HomeRoot, slotUser)
	// Same shape as Cursor's ~/.cursor/: root-owned, sticky-bit group-writable directories
	// (slotUser can create files but — per the sticky bit — cannot delete or rename ones it
	// doesn't own) holding individually root-owned, mode-0444 config files. A slot process
	// cannot read its own gate out of the loop even though it runs as the uid the gate exists
	// to constrain (review finding: workspace-synced content under gdgwiki-group-writable
	// WikiRoot could not make this guarantee, since every slot user is a member of gdgwiki).
	// .gemini/config/hooks.json is agy's "Global Customizations Root" (its own term) for the
	// PreToolUse gate; .gemini/antigravity-cli/settings.json is a second, independent gate
	// agy enforces for any "command"-type tool call regardless of the hook's own verdict —
	// found empirically in the ADR-032 E2E test, not documented anywhere discovered so far.
	return []Resource{
		&DirResource{
			Path:  filepath.Join(slotHome, ".gemini"),
			Mode:  unixFileMode(0o1775),
			Owner: "root",
			Group: slotUser,
		},
		&DirResource{
			Path:  filepath.Join(slotHome, ".gemini", "config"),
			Mode:  unixFileMode(0o1775),
			Owner: "root",
			Group: slotUser,
		},
		&DirResource{
			Path:  filepath.Join(slotHome, ".gemini", "antigravity-cli"),
			Mode:  unixFileMode(0o1775),
			Owner: "root",
			Group: slotUser,
		},
	}, nil
}

func (a *antigravityPolicy) BuildSlotResources(paths layoutPaths, slot int, slotRunDir, indexSocket string) ([]Resource, error) {
	if paths.Spec.Backend.Isolation.ToolGate != "preToolUse-failClosed" {
		return nil, nil
	}
	slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
	slotHome := filepath.Join(paths.HomeRoot, slotUser)
	bundleDir := a.Capabilities().PolicyBundle

	hooks, err := backendConfigBytes(bundleDir, "hooks.json")
	if err != nil {
		return nil, err
	}
	settings, err := backendConfigBytes(bundleDir, "settings.json")
	if err != nil {
		return nil, err
	}

	return []Resource{
		&FileResource{
			Path:  filepath.Join(slotHome, ".gemini", "config", "hooks.json"),
			Data:  []byte(subst(string(hooks), paths.SpecAgentRoot, "", "")),
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
		&FileResource{
			Path:  filepath.Join(slotHome, ".gemini", "antigravity-cli", "settings.json"),
			Data:  settings,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		},
	}, nil
}
