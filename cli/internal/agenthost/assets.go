package agenthost

import (
	"embed"
	"fmt"
)

// Copied by `pnpm sync:agent-host-assets` from agents-index and agent-host/config.
// A clean `go build` without that step fails on these embed patterns.

//go:embed assets/index-proxy.ts
var indexProxyScript []byte

//go:embed assets/agent-host.json
var defaultSpecJSON []byte

//go:embed assets/config/*
var configTemplates embed.FS

func configBytes(name string) ([]byte, error) {
	data, err := configTemplates.ReadFile("assets/config/" + name)
	if err != nil {
		return nil, fmt.Errorf("missing agent-host config template %s (run pnpm sync:agent-host-assets): %w", name, err)
	}
	return data, nil
}
