package agenthost

import (
	"context"
	"fmt"
	"io/fs"
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
		case "systemd":
			set["systemd"] = true
		case "apparmor":
			set["apparmor"] = true
		case "apt":
			set["apt"] = true
		case "tarball", "tarballs":
			set["tarball"] = true
		case "git":
			set["git"] = true
		case "wiki":
			set["wiki"] = true
		case "exec":
			set["exec"] = true
		default:
			return nil, fmt.Errorf("invalid resource type %q in --only (valid types: user, group, dir, file, sudoers, tmpfiles, symlink, systemd, apparmor, apt, tarball, git, wiki, exec)", item)
		}
	}
	return set, nil
}

func buildDesiredResources(paths layoutPaths, prune bool) ([]Resource, error) {
	backendPolicy, err := GetBackendPolicy(paths.Spec.Backend.Name)
	if err != nil {
		return nil, err
	}

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
	res = append(res, &WikiCloneResource{
		WikiRoot: paths.WikiRoot,
		Prefix:   paths.Prefix,
		User:     "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  paths.RunRoot,
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  paths.VarLibRoot,
		Mode:  0o750,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.VarLibRoot, "workspace-staging"),
		Mode:  0o700,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.VarLibRoot, "workspace-backup"),
		Mode:  0o700,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.VarLibRoot, "workspace-journal"),
		Mode:  0o700,
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
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.EtcRoot, "apparmor.d"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.HomeRoot, "gdgagent-svc", ".config"),
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.HomeRoot, "gdgagent-svc", ".config", "systemd"),
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.HomeRoot, "gdgagent-svc", ".config", "systemd", "user"),
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(paths.HomeRoot, "gdgagent-svc", ".config", "systemd", "user", "xangi.service.d"),
		Mode:  0o755,
		Owner: "gdgagent-svc",
		Group: "gdgagent-svc",
	})

	// Slot directories
	for slot := 0; slot < paths.SlotCount; slot++ {
		slotUser := fmt.Sprintf("gdgagent-run-%d", slot)
		slotDirs, err := backendPolicy.BuildSlotDirectories(paths, slot)
		if err != nil {
			return nil, err
		}
		res = append(res, slotDirs...)
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

	backendHostRes, err := backendPolicy.BuildHostResources(paths)
	if err != nil {
		return nil, err
	}
	res = append(res, backendHostRes...)

	releaseKeyBytes, err := configBytes("release-key.pub")
	if err == nil && len(releaseKeyBytes) > 0 {
		res = append(res, &FileResource{
			Path:  filepath.Join(paths.AgentRoot, "lib", "release-key.pub"),
			Data:  releaseKeyBytes,
			Mode:  0o644,
			Owner: "root",
			Group: "root",
		})
	}

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
	spawnTemplate, err := configBytes("spawn-slot.sh")
	if err != nil {
		return nil, err
	}

	for slot := 0; slot < paths.SlotCount; slot++ {
		specSlotRun := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot))
		indexSocket := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot), "index.sock")

		slotBackendRes, err := backendPolicy.BuildSlotResources(paths, slot, specSlotRun, indexSocket)
		if err != nil {
			return nil, err
		}
		res = append(res, slotBackendRes...)

		if paths.Spec.Backend.Isolation.SlotLauncher {
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
	}

	// 4. Sudoers
	sudoersContent := generateSudoersContent(paths)
	if paths.Spec.Backend.Isolation.SlotLauncher {
		if err := ValidateSudoersSlotLauncher(sudoersContent, paths.SlotCount); err != nil {
			return nil, err
		}
	}
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

	// 6. Systemd units
	userUnitDir := filepath.Join(paths.HomeRoot, "gdgagent-svc", ".config", "systemd", "user")

	xangiUnit := `[Unit]
Description=xangi (GDG agent)
After=network-online.target

[Service]
WorkingDirectory=/opt/xangi
ExecStart=/usr/bin/node /opt/xangi/node_modules/tsx/dist/cli.mjs /opt/xangi/src/index.ts
Environment=XANGI_SETUP_CONFIG_PATH=/home/gdgagent-svc/.config/xangi/xangi.json
Environment=XANGI_SETUP_STATE_DIR=/home/gdgagent-svc/.local/share/xangi
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`
	res = append(res, &SystemdUnitResource{
		UnitName: "xangi.service",
		Path:     filepath.Join(userUnitDir, "xangi.service"),
		Data:     []byte(xangiUnit),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Enable:   true,
		ConditionStart: func() bool {
			sec, err := os.ReadFile("/home/gdgagent-svc/.config/xangi/secrets.json")
			return err == nil && strings.Contains(string(sec), "DISCORD_TOKEN")
		},
		Prefix: paths.Prefix,
	})

	backendModel := paths.Spec.Backend.Model
	if backendModel == "" {
		backendModel = "composer-2.5"
	}
	notify := paths.Spec.Discord.CompletionNotify
	if notify == "" {
		notify = "off"
	}
	modelConf := fmt.Sprintf("[Service]\nEnvironment=AGENT_MODEL=%s\nEnvironment=DISCORD_SHOW_THINKING=%t\nEnvironment=DISCORD_STREAMING=%t\nEnvironment=DISCORD_COMPLETION_NOTIFY=%s\n",
		backendModel, paths.Spec.Discord.ShowThinking, paths.Spec.Discord.Streaming, notify)

	res = append(res, &SystemdUnitResource{
		UnitName: "model.conf",
		Path:     filepath.Join(userUnitDir, "xangi.service.d", "model.conf"),
		Data:     []byte(modelConf),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Prefix:   paths.Prefix,
	})

	if dropIn, ok := paths.Spec.Systemd.DropIns["harness.conf"]; ok {
		var b strings.Builder
		b.WriteString("[Service]\n")
		var keys []string
		for k := range dropIn {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			val := dropIn[k]
			if k == "XANGI_AGENT_SLOT_COUNT" && val == "" {
				val = strconv.Itoa(paths.SlotCount)
			}
			fmt.Fprintf(&b, "Environment=%s=%s\n", k, val)
		}
		res = append(res, &SystemdUnitResource{
			UnitName: "harness.conf",
			Path:     filepath.Join(userUnitDir, "xangi.service.d", "harness.conf"),
			Data:     []byte(b.String()),
			Mode:     0o644,
			Owner:    "gdgagent-svc",
			Group:    "gdgagent-svc",
			Scope:    "user",
			User:     "gdgagent-svc",
			Prefix:   paths.Prefix,
		})
	}

	lfService := `[Unit]
Description=langfuse-forwarder (GDG agent observability)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/langfuse-forwarder
ExecStart=/usr/bin/node /opt/langfuse-forwarder/node_modules/tsx/dist/cli.mjs /opt/langfuse-forwarder/src/index.ts
Environment=DATA_DIR=/home/gdgagent-svc/.local/share/xangi
Environment=LANGFUSE_CREDENTIALS_PATH=/home/gdgagent-svc/.config/langfuse/credentials.json
Environment=LANGFUSE_FORWARDER_STATE_DIR=/home/gdgagent-svc/.local/share/langfuse-forwarder
`
	res = append(res, &SystemdUnitResource{
		UnitName: "langfuse-forwarder.service",
		Path:     filepath.Join(userUnitDir, "langfuse-forwarder.service"),
		Data:     []byte(lfService),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Prefix:   paths.Prefix,
	})

	lfTimer := `[Unit]
Description=Run langfuse-forwarder every 5 minutes

[Timer]
OnUnitActiveSec=5min
OnBootSec=2min
Persistent=true

[Install]
WantedBy=timers.target
`
	res = append(res, &SystemdUnitResource{
		UnitName: "langfuse-forwarder.timer",
		Path:     filepath.Join(userUnitDir, "langfuse-forwarder.timer"),
		Data:     []byte(lfTimer),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Enable:   true,
		ConditionStart: func() bool {
			fi, err := os.Stat("/home/gdgagent-svc/.config/langfuse/credentials.json")
			return err == nil && fi.Size() > 0
		},
		Prefix: paths.Prefix,
	})

	syncService := `[Unit]
Description=agent-host-sync (GDG agent workspace sync)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/gdg agent-host sync-workspace
`
	res = append(res, &SystemdUnitResource{
		UnitName: "agent-host-sync.service",
		Path:     filepath.Join(userUnitDir, "agent-host-sync.service"),
		Data:     []byte(syncService),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Prefix:   paths.Prefix,
	})

	syncTimer := `[Unit]
Description=Run agent-host-sync every 5 minutes

[Timer]
OnUnitActiveSec=5min
OnBootSec=2min
Persistent=true

[Install]
WantedBy=timers.target
`
	res = append(res, &SystemdUnitResource{
		UnitName: "agent-host-sync.timer",
		Path:     filepath.Join(userUnitDir, "agent-host-sync.timer"),
		Data:     []byte(syncTimer),
		Mode:     0o644,
		Owner:    "gdgagent-svc",
		Group:    "gdgagent-svc",
		Scope:    "user",
		User:     "gdgagent-svc",
		Enable:   true,
		Prefix:   paths.Prefix,
	})

	// 8. Runtime Packages & Binaries
	nodeMajor := paths.Spec.Pins.Node.Major
	if nodeMajor == 0 {
		nodeMajor = 22
	}
	nodeMinor := paths.Spec.Pins.Node.MinMinor
	if nodeMinor == 0 {
		nodeMinor = 18
	}
	res = append(res, &AptResource{
		Packages:     []string{"git", "ca-certificates", "curl", "unzip", "sudo"},
		EnsureNode:   true,
		NodeMajor:    nodeMajor,
		NodeMinMinor: nodeMinor,
		Prefix:       paths.Prefix,
	})

	gwsVer := paths.Spec.Pins.GWS.Version
	if gwsVer == "" {
		gwsVer = "v0.22.5"
	}
	res = append(res, &TarballResource{
		Name:          "gws",
		Destination:   filepath.Join(paths.AgentRoot, "bin", "gws-bin"),
		Version:       gwsVer,
		SHA256:        paths.Spec.Pins.GWS.SHA256,
		URLTemplate:   "https://github.com/googleworkspace/cli/releases/download/{version}/google-workspace-cli-{arch}-unknown-linux-gnu.tar.gz",
		VerifyCmd:     []string{filepath.Join(paths.AgentRoot, "bin", "gws-bin"), "--version"},
		VerifyPattern: "gws " + strings.TrimPrefix(gwsVer, "v"),
		Prefix:        paths.Prefix,
	})

	cursorVer := paths.Spec.Pins.CursorAgent.Version
	if cursorVer == "" {
		cursorVer = "2026.08.11-e8db854"
	}
	res = append(res, &TarballResource{
		Name:          "cursor-agent",
		Destination:   "/opt/cursor-agent/cursor-agent",
		Symlink:       "/usr/bin/cursor-agent",
		Version:       cursorVer,
		SHA256:        paths.Spec.Pins.CursorAgent.SHA256,
		URLTemplate:   "https://downloads.cursor.com/lab/{version}/linux/{cursor_arch}/agent-cli-package.tar.gz",
		ExtractMode:   "dir",
		TargetDir:     "/opt/cursor-agent",
		VerifyCmd:     []string{"/usr/bin/cursor-agent", "--version"},
		VerifyPattern: cursorVer,
		Prefix:        paths.Prefix,
	})

	xangiRepo := paths.Spec.Pins.Xangi.Repo
	if xangiRepo == "" {
		xangiRepo = "https://github.com/Harineko0/xangi.git"
	}
	xangiRef := paths.Spec.Pins.Xangi.Ref
	if xangiRef == "" {
		xangiRef = "b3db5919a5e33769ef8d7bcef245aa6b76974948"
	}
	res = append(res, &GitResource{
		Destination: "/opt/xangi",
		Repo:        xangiRepo,
		Ref:         xangiRef,
		Symlink:     "/usr/local/bin/xangi",
		Prefix:      paths.Prefix,
	})
	res = append(res, &ExecResource{
		Name:           "npm-ci:/opt/xangi",
		Command:        []string{"npm", "ci"},
		Dir:            "/opt/xangi",
		WatchFile:      "/opt/xangi/package-lock.json",
		StateFile:      "/opt/xangi/node_modules/.package-lock.sha256",
		CheckDir:       "/opt/xangi/node_modules",
		ChmodRecursive: "/opt/xangi/node_modules",
		Prefix:         paths.Prefix,
	})

	if paths.Prefix == "" {
		lfRes, err := buildLangfuseForwarderResources(paths.Prefix)
		if err == nil {
			res = append(res, lfRes...)
		}
		res = append(res, &ExecResource{
			Name:           "npm-ci:/opt/langfuse-forwarder",
			Command:        []string{"npm", "ci"},
			Dir:            "/opt/langfuse-forwarder",
			WatchFile:      "/opt/langfuse-forwarder/package-lock.json",
			StateFile:      "/opt/langfuse-forwarder/node_modules/.package-lock.sha256",
			CheckDir:       "/opt/langfuse-forwarder/node_modules",
			ChmodRecursive: "/opt/langfuse-forwarder/node_modules",
			Prefix:         paths.Prefix,
		})
	}

	// 9. agents-index daemon (folded in from agents-index/install.sh at Stage 08).
	aiRes, err := buildAgentsIndexResources(paths)
	if err != nil {
		return nil, err
	}
	res = append(res, aiRes...)

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
			if paths.Spec.AgentsIndex.Enabled {
				knownBin["agents-index"] = true
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

func buildLangfuseForwarderResources(prefix string) ([]Resource, error) {
	var res []Resource
	destDir := filepath.Join(prefix, "opt", "langfuse-forwarder")
	res = append(res, &DirResource{
		Path:  destDir,
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})
	res = append(res, &DirResource{
		Path:  filepath.Join(destDir, "src"),
		Mode:  0o755,
		Owner: "root",
		Group: "root",
	})

	err := fs.WalkDir(langfuseForwarderFS, "assets/langfuse-forwarder", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel("assets/langfuse-forwarder", path)
		if err != nil {
			return err
		}
		data, err := langfuseForwarderFS.ReadFile(path)
		if err != nil {
			return err
		}
		res = append(res, &FileResource{
			Path:  filepath.Join(destDir, rel),
			Data:  data,
			Mode:  0o644,
			Owner: "root",
			Group: "root",
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to read embedded langfuse-forwarder: %w", err)
	}
	return res, nil
}
