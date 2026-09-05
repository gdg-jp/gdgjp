package agenthost

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Copied by `pnpm sync:agent-host-assets` from agents-index and agent-host/config.
// A clean `go build` without that step fails on these embed patterns.

//go:embed assets/index-proxy.ts
var indexProxyScript []byte

//go:embed assets/agent-host.json
var defaultSpecJSON []byte

//go:embed assets/config/*
var configTemplates embed.FS

//go:embed assets/langfuse-forwarder/* assets/langfuse-forwarder/src/*
var langfuseForwarderFS embed.FS

//go:embed assets/agents-index/package.json assets/agents-index/package-lock.json
//go:embed assets/agents-index/src/* assets/agents-index/src/acl/* assets/agents-index/src/indexer/*
var agentsIndexFS embed.FS

var (
	configOverrideMu   sync.RWMutex
	configOverrideRoot string
)

// withConfigOverrideRoot directs configBytes/backendConfigBytes to prefer reading from dir for the
// duration of fn, falling back to the gdg binary's own go:embed defaults for any file dir doesn't
// have. release.go's applyReleaseGeneration uses this so a Tier 2 release's own verified config/
// -- not the config baked into whatever gdg binary happens to be running -- is what actually gets
// converged; without it, a config-only release (e.g. a hooks.json change) would be silently
// published but never applied.
//
// This is deliberately process-wide global state rather than a parameter threaded through every
// configBytes call site: several of those call sites (ValidateBundleInvariants, invoked from
// parseSpecBytes itself) sit underneath spec *parsing*, which has no paths/layout value to carry
// an override through. gdg's CLI commands perform one agent-host operation at a time in a single
// process; this is not safe to use from multiple goroutines concurrently within one process.
func withConfigOverrideRoot(dir string, fn func() error) error {
	configOverrideMu.Lock()
	previous := configOverrideRoot
	configOverrideRoot = dir
	configOverrideMu.Unlock()
	defer func() {
		configOverrideMu.Lock()
		configOverrideRoot = previous
		configOverrideMu.Unlock()
	}()
	return fn()
}

func configBytes(name string) ([]byte, error) {
	configOverrideMu.RLock()
	override := configOverrideRoot
	configOverrideMu.RUnlock()
	if override != "" {
		if data, err := os.ReadFile(filepath.Join(override, name)); err == nil {
			return data, nil
		}
		// Fall through to the embedded default: an older release built before this file existed
		// should not break convergence of everything else.
	}
	data, err := configTemplates.ReadFile("assets/config/" + name)
	if err != nil {
		return nil, fmt.Errorf("missing agent-host config template %s (run pnpm sync:agent-host-assets): %w", name, err)
	}
	return data, nil
}

func backendConfigBytes(backend, name string) ([]byte, error) {
	return configBytes("backends/" + backend + "/" + name)
}
