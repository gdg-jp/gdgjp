package agenthost

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

// PlanOptions contains configuration for planning changes.
type PlanOptions struct {
	SpecPath       string
	OverlayPath    string
	Prefix         string
	SlotCount      int
	Only           string
	Prune          bool
	ApplyOwnership bool
}

// Plan represents the planned changes for the agent host.
type Plan struct {
	Paths     layoutPaths
	Resources []Resource
	Changes   []Change
}

func (p *Plan) HasChanges() bool {
	for _, c := range p.Changes {
		if c.Action != ActionNone {
			return true
		}
	}
	return false
}

func (p *Plan) ChangeCount() int {
	count := 0
	for _, c := range p.Changes {
		if c.Action != ActionNone {
			count++
		}
	}
	return count
}

func (p *Plan) DiffSummary() string {
	var b strings.Builder
	for _, c := range p.Changes {
		if c.Action != ActionNone {
			b.WriteString(c.String())
			b.WriteString("\n")
		}
	}
	return strings.TrimSpace(b.String())
}

// BuildPlan constructs and plans all host resources according to the spec.
func BuildPlan(ctx context.Context, opts PlanOptions) (*Plan, error) {
	spec, err := loadSpecWithOverlay(opts.SpecPath, opts.OverlayPath)
	if err != nil {
		return nil, err
	}
	paths, err := resolveLayoutPaths(spec, opts.Prefix, opts.SlotCount)
	if err != nil {
		return nil, err
	}

	if paths.Prefix == "" && os.Getuid() != 0 {
		return nil, ErrNeedRoot
	}

	resources, err := buildDesiredResources(paths, opts.Prune)
	if err != nil {
		return nil, err
	}

	// Filter by --only if specified
	onlySet, err := parseOnlyFilter(opts.Only)
	if err != nil {
		return nil, err
	}
	if len(onlySet) > 0 {
		var filtered []Resource
		for _, r := range resources {
			if onlySet[r.ResourceType()] {
				filtered = append(filtered, r)
			}
		}
		resources = filtered
	}

	plan := &Plan{
		Paths:     paths,
		Resources: resources,
	}

	for _, r := range resources {
		change, planErr := r.Plan(ctx)
		if planErr != nil {
			return nil, fmt.Errorf("planning %s failed: %w", r.ID(), planErr)
		}
		plan.Changes = append(plan.Changes, change)
	}

	return plan, nil
}

func parseOnlyFilter(only string) (map[string]bool, error) {
	if strings.TrimSpace(only) == "" {
		return nil, nil
	}
	set := make(map[string]bool)
	for _, item := range strings.Split(only, ",") {
		t := strings.TrimSpace(strings.ToLower(item))
		if t == "" {
			return nil, fmt.Errorf("invalid empty value in --only filter")
		}
		switch t {
		case "user", "users":
			set["user"] = true
			set["group"] = true
		case "group", "groups":
			set["group"] = true
		case "dir", "dirs", "directory", "directories":
			set["dir"] = true
		case "file", "files":
			set["file"] = true
		case "sudoers":
			set["sudoers"] = true
		case "tmpfiles":
			set["tmpfiles"] = true
		case "symlink", "symlinks":
			set["symlink"] = true
		default:
			return nil, fmt.Errorf("invalid resource type %q in --only (valid types: user, group, dir, file, sudoers, tmpfiles, symlink)", item)
		}
	}
	return set, nil
}

func buildDesiredResources(paths layoutPaths, prune bool) ([]Resource, error) {
	var res []Resource

	// 1. Users and Groups
	res = append(res, &GroupResource{Name: "gdgwiki", System: true, Prefix: paths.Prefix})
	res = append(res, &GroupResource{Name: "gdgagent-svc", System: true, Prefix: paths.Prefix})

	var svcSlotGroups []string
	for slot := 0; slot < paths.SlotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		res = append(res, &GroupResource{Name: slotUser, System: true, Prefix: paths.Prefix})
		svcSlotGroups = append(svcSlotGroups, slotUser)
	}

	svcGroups := append([]string{"gdgwiki"}, svcSlotGroups...)
	res = append(res, &UserResource{
		Name:         "gdgagent-svc",
		System:       true,
		Home:         filepath.Join(paths.HomeRoot, "gdgagent-svc"),
		Shell:        "/usr/sbin/nologin",
		PrimaryGroup: "gdgagent-svc",
		Groups:       svcGroups,
		Prefix:       paths.Prefix,
	})

	for slot := 0; slot < paths.SlotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		res = append(res, &UserResource{
			Name:         slotUser,
			System:       true,
			Home:         filepath.Join(paths.HomeRoot, slotUser),
			Shell:        "/usr/sbin/nologin",
			PrimaryGroup: slotUser,
			Groups:       []string{"gdgwiki"},
			Prefix:       paths.Prefix,
		})
	}

	// 2. Directories
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.AgentRoot, "lib"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.AgentRoot, "bin"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &DirResource{
		Path:           paths.WikiRoot,
		Mode:           unixFileMode(0o2770),
		Owner:          "gdgagent-svc",
		Group:          "gdgwiki",
		RecursiveChown: true,
		RecursiveChmod: true,
	})
	res = append(res, &DirResource{
		Path:  paths.RunRoot,
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.EtcRoot, "sudoers.d"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.EtcRoot, "tmpfiles.d"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})

	// Slot directories
	for slot := 0; slot < paths.SlotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		slotHome := filepath.Join(paths.HomeRoot, slotUser)
		res = append(res, &DirResource{
			Path:  filepath.Join(slotHome, ".cursor"),
			Mode:  unixFileMode(0o1775),
			Owner: "root",
			Group: slotUser,
		})
		res = append(res, &DirResource{
			Path:  filepath.Join(slotHome, ".cursor", "projects"),
			Mode:  0o755,
			Owner: slotUser,
			Group: slotUser,
		})
		res = append(res, &DirResource{
			Path:  filepath.Join(paths.RunRoot, strconv.Itoa(slot)),
			Mode:  0o750,
			Owner: "gdgagent-svc",
			Group: slotUser,
		})
	}

	// 3. Files: package.json, lib scripts, wrappers
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "package.json"),
		Data:  wiki.HooksPackageJSON(),
		Mode:  0o444,
		Owner: "root",
		Group: "root",
	})

	for name, body := range wiki.AgentLibFiles() {
		res = append(res, &FileResource{
			Path:  filepath.Join(paths.AgentRoot, "lib", name),
			Data:  body,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
	}

	if len(indexProxyScript) == 0 {
		return nil, fmt.Errorf("embedded index-proxy.ts is empty; run pnpm sync:agent-host-assets")
	}
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "lib", "index-proxy.ts"),
		Data:  indexProxyScript,
		Mode:  0o444,
		Owner: "root",
		Group: "root",
	})

	cliConfigTemplate, err := configBytes("cli-config.json")
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

	// Bin wrappers
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "bin", "index-proxy"),
		Data:  []byte("#!/bin/sh\nexec /usr/bin/node \"" + paths.AgentRoot + "/lib/index-proxy.ts\" \"$@\"\n"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "bin", "wk"),
		Data:  []byte("#!/bin/sh\nexec /usr/bin/node \"" + paths.AgentRoot + "/lib/wk.ts\" \"$@\"\n"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &FileResource{
		Path:  filepath.Join(paths.AgentRoot, "bin", "gws"),
		Data:  []byte("#!/bin/sh\nexec /usr/bin/node \"" + paths.AgentRoot + "/lib/gws.ts\" \"$@\"\n"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})

	// Slot configs and launchers
	hooksTemplate, err := configBytes("hooks.json")
	if err != nil {
		return nil, err
	}
	sandboxTemplate, err := configBytes("sandbox.json.in")
	if err != nil {
		return nil, err
	}
	mcpTemplate, err := configBytes("mcp.json.in")
	if err != nil {
		return nil, err
	}
	extraMCP, err := configBytes("extra-mcp.json")
	if err != nil {
		return nil, err
	}
	permissions, err := configBytes("permissions.json")
	if err != nil {
		return nil, err
	}
	spawnTemplate, err := configBytes("spawn-slot.sh")
	if err != nil {
		return nil, err
	}

	for slot := 0; slot < paths.SlotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		slotHome := filepath.Join(paths.HomeRoot, slotUser)
		cursorDir := filepath.Join(slotHome, ".cursor")
		specSlotRun := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot))
		indexSocket := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot), "index.sock")

		res = append(res, &FileResource{
			Path:  filepath.Join(cursorDir, "hooks.json"),
			Data:  []byte(subst(string(hooksTemplate), paths.SpecAgentRoot, "", "")),
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
		res = append(res, &FileResource{
			Path:  filepath.Join(cursorDir, "cli-config.json"),
			Data:  []byte(subst(string(cliConfigTemplate), paths.SpecAgentRoot, "", "")),
			Mode:  0o644,
			Owner: slotUser,
			Group: slotUser,
		})
		res = append(res, &FileResource{
			Path:  filepath.Join(cursorDir, "sandbox.json"),
			Data:  []byte(subst(string(sandboxTemplate), paths.SpecAgentRoot, specSlotRun, "")),
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
		mergedMCP, mcpErr := mergeSlotMCP([]byte(subst(string(mcpTemplate), paths.SpecAgentRoot, "", indexSocket)), extraMCP)
		if mcpErr != nil {
			return nil, mcpErr
		}
		res = append(res, &FileResource{
			Path:  filepath.Join(cursorDir, "mcp.json"),
			Data:  mergedMCP,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})
		res = append(res, &FileResource{
			Path:  filepath.Join(cursorDir, "permissions.json"),
			Data:  permissions,
			Mode:  0o444,
			Owner: "root",
			Group: "root",
		})

		spawn := subst(string(spawnTemplate), paths.SpecAgentRoot, "", "")
		spawn = strings.ReplaceAll(spawn, "__SLOT__", strconv.Itoa(slot))
		res = append(res, &FileResource{
			Path:  filepath.Join(paths.AgentRoot, "bin", fmt.Sprintf("spawn-slot-%d", slot)),
			Data:  []byte(spawn),
			Mode:  0o755,
			Owner: "root",
			Group: "root",
		})
	}

	// 4. Sudoers
	sudoersContent := generateSudoersContent(paths)
	res = append(res, &SudoersResource{
		Path: filepath.Join(paths.EtcRoot, "sudoers.d", "gdg-agent"),
		Data: []byte(sudoersContent),
	})

	// 5. Tmpfiles
	tmpfilesContent := generateTmpfilesContent(paths)
	res = append(res, &TmpfilesResource{
		Path:   filepath.Join(paths.EtcRoot, "tmpfiles.d", "gdg-agent.conf"),
		Data:   []byte(tmpfilesContent),
		Prefix: paths.Prefix,
	})

	// 6. Cleanup of obsolete/decommissioned resources gated by prune
	if prune {
		// 6a. Undeclared bin files (ResourceType: "file")
		binDir := filepath.Join(paths.AgentRoot, "bin")
		if entries, err := os.ReadDir(binDir); err == nil {
			knownBin := map[string]bool{
				"wk":          true,
				"gws":         true,
				"index-proxy": true,
			}
			for slot := 0; slot < paths.SlotCount; slot++ {
				knownBin["spawn-slot-"+strconv.Itoa(slot)] = true
			}
			for _, e := range entries {
				if !e.IsDir() && !knownBin[e.Name()] {
					res = append(res, &FileDeleteResource{
						Path: filepath.Join(binDir, e.Name()),
					})
				}
			}
		}

		// 6b. Decommissioned slot accounts and whole homes (ResourceType: "user")
		slotsToPrune := detectSlotsToPrune(paths)
		for _, slot := range slotsToPrune {
			res = append(res, &PruneSlotResource{
				Slot:  slot,
				Paths: paths,
			})
		}
	}

	return res, nil
}

func detectSlotsToPrune(paths layoutPaths) []int {
	seen := make(map[int]bool)

	// Check /run/gdg-agent
	if entries, err := os.ReadDir(paths.RunRoot); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			if idx, err := strconv.Atoi(e.Name()); err == nil && idx >= paths.SlotCount {
				seen[idx] = true
			}
		}
	}

	// Check /home
	if entries, err := os.ReadDir(paths.HomeRoot); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if strings.HasPrefix(name, "gdgagent-run-") {
				if idx, err := strconv.Atoi(strings.TrimPrefix(name, "gdgagent-run-")); err == nil && idx >= paths.SlotCount {
					seen[idx] = true
				}
			}
		}
	}

	// Check OS accounts when running against live system
	if paths.Prefix == "" {
		scanAccountSlots(seen, paths.SlotCount)
	}

	var result []int
	for idx := range seen {
		result = append(result, idx)
	}
	sort.Ints(result)
	return result
}

func scanAccountSlots(seen map[int]bool, slotCount int) {
	if getentPath, err := exec.LookPath("getent"); err == nil {
		if out, err := exec.Command(getentPath, "passwd").Output(); err == nil {
			scanColonEntries(out, seen, slotCount)
		}
		if out, err := exec.Command(getentPath, "group").Output(); err == nil {
			scanColonEntries(out, seen, slotCount)
		}
		return
	}
	if data, err := os.ReadFile("/etc/passwd"); err == nil {
		scanColonEntries(data, seen, slotCount)
	}
	if data, err := os.ReadFile("/etc/group"); err == nil {
		scanColonEntries(data, seen, slotCount)
	}
}

func scanColonEntries(data []byte, seen map[int]bool, slotCount int) {
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) > 0 && strings.HasPrefix(fields[0], "gdgagent-run-") {
			if idx, err := strconv.Atoi(strings.TrimPrefix(fields[0], "gdgagent-run-")); err == nil && idx >= slotCount {
				seen[idx] = true
			}
		}
	}
}

func generateSudoersContent(paths layoutPaths) string {
	var b strings.Builder
	b.WriteString("# Generated by agent-host/lib/install-layout.sh. No wildcards.\n")
	b.WriteString("Defaults:gdgagent-svc env_reset\n")
	for slot := 0; slot < paths.SlotCount; slot++ {
		fmt.Fprintf(&b, "gdgagent-svc ALL=(gdgagent-run-%d) NOPASSWD: %s/bin/spawn-slot-%d\n", slot, paths.SpecAgentRoot, slot)
		fmt.Fprintf(&b, "gdgagent-svc ALL=(root) NOPASSWD: /usr/bin/pkill -KILL -u gdgagent-run-%d\n", slot)
	}
	return b.String()
}

func generateTmpfilesContent(paths layoutPaths) string {
	var b strings.Builder
	fmt.Fprintf(&b, "d %s 0755 gdgagent-svc gdgagent-svc -\n", paths.SpecRunRoot)
	for slot := 0; slot < paths.SlotCount; slot++ {
		fmt.Fprintf(&b, "d %s/%d 0750 gdgagent-svc gdgagent-run-%d -\n", paths.SpecRunRoot, slot, slot)
	}
	return b.String()
}
