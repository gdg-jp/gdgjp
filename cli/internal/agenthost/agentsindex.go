package agenthost

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

// optAgentsIndex is the self-contained deployment root for the agents-index
// daemon. It is a fixed path like /opt/xangi and /opt/langfuse-forwarder: the
// daemon runs from here, never from a monorepo checkout, so removing /opt/gdgjp
// (Stage 13) cannot stop it.
const optAgentsIndex = "/opt/agents-index"

// agentsIndexACLImportRewrites maps each agents-index source file that imports
// the shared ACL surface to the relative specifier of the vendored bundle we
// drop alongside it. The workspace package imports "@gdgjp/gdg-lib/acl/agent";
// the deployed copy imports the esbuild bundle at src/acl/agent.ts instead so it
// needs no workspace resolution.
var agentsIndexACLImportRewrites = map[string]string{
	"authz.ts":           "./acl/agent.ts",
	"acl/filter.ts":      "./agent.ts",
	"acl/frontmatter.ts": "./agent.ts",
}

// deployedArtifact is one file written under /opt/agents-index, keyed by its
// deploy-relative path so the revision hash is prefix-independent.
type deployedArtifact struct {
	rel  string
	data []byte
}

// buildAgentsIndexResources expands the agents-index daemon into the same
// resource types (dir/file/systemd/exec) the rest of the converger uses. There
// is no ordering dependency on the agent-host layout: every resource here lands
// in the one plan the caller is assembling.
//
// When spec.agentsIndex.enabled is false it emits the teardown instead: the
// systemd unit is stopped/disabled/removed and /opt/agents-index is deleted. The
// persistent data directory (/var/lib/agents-index) is left in place.
func buildAgentsIndexResources(paths layoutPaths) ([]Resource, error) {
	ai := paths.Spec.AgentsIndex
	// A system unit (not systemctl --user): the daemon must join the gdgwiki and
	// gdgagent-run-* groups via SupplementaryGroups= to chgrp the per-slot index
	// sockets, and an unprivileged --user manager cannot set group credentials.
	unitPath := filepath.Join(paths.EtcRoot, "systemd", "system", "agents-index.service")

	if !ai.Enabled {
		return []Resource{
			&SystemdUnitDeleteResource{
				UnitName: "agents-index.service",
				Path:     unitPath,
				Scope:    "system",
				Prefix:   paths.Prefix,
			},
			&FileDeleteResource{Path: filepath.Join(paths.AgentRoot, "bin", "agents-index")},
			&DirDeleteResource{Path: paths.Prefix + optAgentsIndex},
		}, nil
	}

	var res []Resource
	var artifacts []deployedArtifact

	// 1. Persistent data directory (index.db + HuggingFace model cache). Private
	//    to the service identity; agent slots must never read the index db.
	dataDir := paths.Prefix + ai.DataDir
	res = append(res, &DirResource{
		Path:  dataDir,
		Mode:  0o700,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(dataDir, "hf"),
		Mode:  0o700,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})

	// 2. Self-contained deployment tree at /opt/agents-index.
	deployRoot := paths.Prefix + optAgentsIndex
	for _, d := range []string{"", "src", "src/acl", "src/indexer"} {
		res = append(res, &DirResource{
			Path:  filepath.Join(deployRoot, d),
			Mode:  0o755,
			Owner: "root",
			Group: "root",
		})
	}
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.EtcRoot, "systemd", "system"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})

	addFile := func(rel string, data []byte) {
		artifacts = append(artifacts, deployedArtifact{rel: rel, data: data})
		res = append(res, &FileResource{
			Path:  filepath.Join(deployRoot, filepath.FromSlash(rel)),
			Data:  data,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
	}

	pkgJSON, err := agentsIndexFS.ReadFile("assets/agents-index/package.json")
	if err != nil {
		return nil, fmt.Errorf("embedded agents-index package.json missing (run pnpm sync:agent-host-assets): %w", err)
	}
	pkgLock, err := agentsIndexFS.ReadFile("assets/agents-index/package-lock.json")
	if err != nil {
		return nil, fmt.Errorf("embedded agents-index package-lock.json missing (run pnpm sync:agent-host-assets): %w", err)
	}
	addFile("package.json", pkgJSON)
	addFile("package-lock.json", pkgLock)

	// 3. Daemon sources, copied verbatim from the @gdgjp/agents-index workspace
	//    package, with the ACL import specifier rewritten to the vendored bundle.
	err = fs.WalkDir(agentsIndexFS, "assets/agents-index/src", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel("assets/agents-index/src", path)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		data, readErr := agentsIndexFS.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		if target, ok := agentsIndexACLImportRewrites[rel]; ok {
			rewritten := strings.ReplaceAll(
				string(data),
				`"@gdgjp/gdg-lib/acl/agent"`,
				`"`+target+`"`,
			)
			if rewritten == string(data) {
				return fmt.Errorf("agents-index source %s no longer imports @gdgjp/gdg-lib/acl/agent; update agentsIndexACLImportRewrites", rel)
			}
			data = []byte(rewritten)
		}
		addFile("src/"+rel, data)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("expanding embedded agents-index sources: %w", err)
	}

	// 4. Vendored ACL bundle: the same esbuild output that Stage 05 places at
	//    /opt/gdg-agent/lib/acl.ts, dropped here so the rewritten imports resolve
	//    without @gdgjp/gdg-lib on disk.
	aclBundle := wiki.AgentLibFiles()["acl.ts"]
	if len(aclBundle) == 0 {
		return nil, fmt.Errorf("embedded acl.ts bundle is empty; run pnpm build:acl")
	}
	addFile("src/acl/agent.ts", aclBundle)

	// 5. Launcher shim on PATH-adjacent bin, mirroring wk/gws/index-proxy.
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "bin", "agents-index"),
		Data:  []byte("#!/bin/sh\nset -eu\ncd " + optAgentsIndex + "\nexec /usr/bin/node " + optAgentsIndex + "/src/cli.ts \"$@\"\n"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})

	// 6. Dependency install, gated on package-lock.json changes (never runs
	//    unconditionally). No-op under --prefix.
	res = append(res, &ExecResource{
		Name:           "npm-ci:" + optAgentsIndex,
		Command:        []string{"npm", "ci"},
		Dir:            optAgentsIndex,
		WatchFile:      filepath.Join(optAgentsIndex, "package-lock.json"),
		StateFile:      filepath.Join(optAgentsIndex, "node_modules", ".package-lock.sha256"),
		CheckDir:       filepath.Join(optAgentsIndex, "node_modules"),
		ChmodRecursive: filepath.Join(optAgentsIndex, "node_modules"),
		Prefix:         paths.Prefix,
	})

	// 7. systemd --user unit under gdgagent-svc, exactly like xangi.service.
	//    --slots and SupplementaryGroups are derived from spec.slotCount so the
	//    old --slots literal cannot drift. The artifacts-rev line makes the unit
	//    content change whenever any deployed source, the vendored ACL bundle, or
	//    the lockfile changes, so SystemdUnitResource restarts the daemon instead
	//    of leaving an old Node process running new-on-disk code.
	rev := agentsIndexArtifactsRev(artifacts)
	res = append(res, &SystemdUnitResource{
		UnitName: "agents-index.service",
		Path:     unitPath,
		Data:     []byte(agentsIndexUnit(paths, rev)),
		Mode:     0o644,
		Owner:    "root",
		Group:    "root",
		Scope:    "system",
		Enable:   true,
		ConditionStart: func() bool {
			_, err := os.Stat(filepath.Join(optAgentsIndex, "node_modules"))
			return err == nil
		},
		Prefix: paths.Prefix,
	})

	return res, nil
}

// agentsIndexArtifactsRev is a stable digest of everything deployed under
// /opt/agents-index, so a code-only change (no unit edit) still flips the unit
// file and triggers a restart.
func agentsIndexArtifactsRev(files []deployedArtifact) string {
	sorted := append([]deployedArtifact(nil), files...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].rel < sorted[j].rel })
	h := sha256.New()
	for _, f := range sorted {
		h.Write([]byte(f.rel))
		h.Write([]byte{0})
		h.Write(f.data)
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func agentsIndexSupplementaryGroups(slotCount int) string {
	groups := []string{"gdgwiki"}
	for slot := 0; slot < slotCount; slot++ {
		groups = append(groups, fmt.Sprintf("gdgagent-run-%d", slot))
	}
	return strings.Join(groups, " ")
}

func agentsIndexUnit(paths layoutPaths, artifactsRev string) string {
	ai := paths.Spec.AgentsIndex
	return fmt.Sprintf(`[Unit]
Description=GDG agents-index (ACL-filtered wiki search)
# gdg-artifacts-rev: %s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gdgagent-svc
Group=gdgagent-svc
SupplementaryGroups=%s
WorkingDirectory=%s
ExecStart=/usr/bin/node %s/src/cli.ts watch --root %s --run-root %s --slots %d --db %s
Environment=HF_HOME=%s/hf
Environment=HOME=/home/gdgagent-svc
Restart=on-failure
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
`,
		artifactsRev,
		agentsIndexSupplementaryGroups(paths.SlotCount),
		optAgentsIndex,
		optAgentsIndex,
		paths.SpecWikiRoot,
		paths.SpecRunRoot,
		paths.SlotCount,
		ai.DBPath,
		ai.DataDir,
	)
}
