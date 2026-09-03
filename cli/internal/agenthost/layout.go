package agenthost

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

type mcpFile struct {
	MCPServers map[string]mcpServer `json:"mcpServers"`
}

type mcpServer struct {
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
}

type EmitOptions struct {
	SpecPath       string
	Prefix         string
	SlotCount      int
	ApplyOwnership bool
}

func EmitLayout(opts EmitOptions) error {
	spec, err := loadSpec(opts.SpecPath)
	if err != nil {
		return err
	}
	paths, err := resolveLayoutPaths(spec, opts.Prefix, opts.SlotCount)
	if err != nil {
		return err
	}
	if err := emitFiles(paths); err != nil {
		return err
	}
	if opts.ApplyOwnership {
		if err := ApplyOwnership(paths); err != nil {
			return err
		}
	}
	fmt.Printf("Installed agent layout under %s (%d slots)\n", paths.AgentRoot, paths.SlotCount)
	return nil
}

func emitFiles(paths layoutPaths) error {
	if err := os.RemoveAll(filepath.Join(paths.AgentRoot, "bin")); err != nil {
		return err
	}
	for _, dir := range []string{
		filepath.Join(paths.AgentRoot, "lib"),
		filepath.Join(paths.AgentRoot, "bin"),
		paths.WikiRoot,
		paths.RunRoot,
		filepath.Join(paths.EtcRoot, "sudoers.d"),
		filepath.Join(paths.EtcRoot, "tmpfiles.d"),
	} {
		if err := mkdirMode(dir, 0o755); err != nil {
			return err
		}
	}

	if err := writeFile(filepath.Join(paths.AgentRoot, "package.json"), wiki.HooksPackageJSON(), 0o444); err != nil {
		return err
	}
	for name, body := range wiki.AgentLibFiles() {
		if err := writeFile(filepath.Join(paths.AgentRoot, "lib", name), body, 0o444); err != nil {
			return err
		}
	}
	if len(indexProxyScript) == 0 {
		return fmt.Errorf("embedded index-proxy.ts is empty; run pnpm sync:agent-host-assets")
	}
	if err := writeFile(filepath.Join(paths.AgentRoot, "lib", "index-proxy.ts"), indexProxyScript, 0o444); err != nil {
		return err
	}

	cliConfigTemplate, err := configBytes("cli-config.json")
	if err != nil {
		return err
	}
	if err := writeFile(
		filepath.Join(paths.AgentRoot, "lib", "cli-config.json"),
		[]byte(subst(string(cliConfigTemplate), paths.SpecAgentRoot, "", "")),
		0o444,
	); err != nil {
		return err
	}

	if err := writeWrapper(paths.AgentRoot, "index-proxy", "index-proxy.ts"); err != nil {
		return err
	}
	if err := writeWrapper(paths.AgentRoot, "wk", "wk.ts"); err != nil {
		return err
	}
	if err := writeWrapper(paths.AgentRoot, "gws", "gws.ts"); err != nil {
		return err
	}

	if err := writeSudoers(paths); err != nil {
		return err
	}
	if err := writeTmpfiles(paths); err != nil {
		return err
	}

	hooksTemplate, err := configBytes("hooks.json")
	if err != nil {
		return err
	}
	sandboxTemplate, err := configBytes("sandbox.json.in")
	if err != nil {
		return err
	}
	mcpTemplate, err := configBytes("mcp.json.in")
	if err != nil {
		return err
	}
	extraMCP, err := configBytes("extra-mcp.json")
	if err != nil {
		return err
	}
	permissions, err := configBytes("permissions.json")
	if err != nil {
		return err
	}
	spawnTemplate, err := configBytes("spawn-slot.sh")
	if err != nil {
		return err
	}

	for slot := 0; slot < paths.SlotCount; slot++ {
		slotHome := filepath.Join(paths.HomeRoot, "gdgagent-run-"+strconv.Itoa(slot))
		cursorDir := filepath.Join(slotHome, ".cursor")
		if err := mkdirMode(cursorDir, 0o1775); err != nil {
			return err
		}
		if err := mkdirMode(filepath.Join(cursorDir, "projects"), 0o755); err != nil {
			return err
		}
		info, err := os.Lstat(cursorDir)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("%s must be a real directory, not a symlink", cursorDir)
		}

		specSlotRun := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot))
		indexSocket := filepath.Join(paths.SpecRunRoot, strconv.Itoa(slot), "index.sock")
		if err := writeFile(filepath.Join(cursorDir, "hooks.json"), []byte(subst(string(hooksTemplate), paths.SpecAgentRoot, "", "")), 0o444); err != nil {
			return err
		}
		if err := writeFile(filepath.Join(cursorDir, "cli-config.json"), []byte(subst(string(cliConfigTemplate), paths.SpecAgentRoot, "", "")), 0o644); err != nil {
			return err
		}
		if err := writeFile(
			filepath.Join(cursorDir, "sandbox.json"),
			[]byte(subst(string(sandboxTemplate), paths.SpecAgentRoot, specSlotRun, "")),
			0o444,
		); err != nil {
			return err
		}
		merged, err := mergeSlotMCP([]byte(subst(string(mcpTemplate), paths.SpecAgentRoot, "", indexSocket)), extraMCP)
		if err != nil {
			return err
		}
		if err := writeFile(filepath.Join(cursorDir, "mcp.json"), merged, 0o444); err != nil {
			return err
		}
		if err := writeFile(filepath.Join(cursorDir, "permissions.json"), permissions, 0o444); err != nil {
			return err
		}

		spawn := subst(string(spawnTemplate), paths.SpecAgentRoot, "", "")
		spawn = strings.ReplaceAll(spawn, "__SLOT__", strconv.Itoa(slot))
		if err := writeFile(filepath.Join(paths.AgentRoot, "bin", "spawn-slot-"+strconv.Itoa(slot)), []byte(spawn), 0o755); err != nil {
			return err
		}
		if err := mkdirMode(filepath.Join(paths.RunRoot, strconv.Itoa(slot)), 0o750); err != nil {
			return err
		}
	}

	if err := reconcileDecommissioned(paths); err != nil {
		return err
	}

	if paths.Prefix == "" {
		if err := maybeChownWiki(paths.WikiRoot); err != nil {
			return err
		}
	}
	if err := os.Chmod(paths.WikiRoot, unixFileMode(0o2770)); err != nil {
		return err
	}
	if err := os.Chmod(paths.RunRoot, 0o755); err != nil {
		return err
	}
	return nil
}

func writeWrapper(agentRoot, name, libFile string) error {
	body := "#!/bin/sh\nexec /usr/bin/node \"" + agentRoot + "/lib/" + libFile + "\" \"$@\"\n"
	return writeFile(filepath.Join(agentRoot, "bin", name), []byte(body), 0o755)
}

func writeSudoers(paths layoutPaths) error {
	dir := filepath.Join(paths.EtcRoot, "sudoers.d")
	if err := mkdirMode(dir, 0o755); err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString("# Generated by agent-host/lib/install-layout.sh. No wildcards.\n")
	b.WriteString("Defaults:gdgagent-svc env_reset\n")
	for slot := 0; slot < paths.SlotCount; slot++ {
		fmt.Fprintf(&b, "gdgagent-svc ALL=(gdgagent-run-%d) NOPASSWD: %s/bin/spawn-slot-%d\n", slot, paths.SpecAgentRoot, slot)
		fmt.Fprintf(&b, "gdgagent-svc ALL=(root) NOPASSWD: /usr/bin/pkill -KILL -u gdgagent-run-%d\n", slot)
	}

	tmp, err := os.CreateTemp(dir, ".gdg-agent.tmp.")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(b.String()); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}

	visudo := lookVisudo()
	if visudo == "" {
		_ = os.Remove(tmpName)
		return fmt.Errorf("visudo is required to validate sudoers file before replacement")
	}
	cmd := exec.Command(visudo, "-cf", tmpName)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("visudo validation failed for generated sudoers file: %s", strings.TrimSpace(string(out)))
	}
	if err := os.Chmod(tmpName, 0o440); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, filepath.Join(dir, "gdg-agent"))
}

func writeTmpfiles(paths layoutPaths) error {
	dir := filepath.Join(paths.EtcRoot, "tmpfiles.d")
	if err := mkdirMode(dir, 0o755); err != nil {
		return err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "d %s 0755 gdgagent-svc gdgagent-svc -\n", paths.SpecRunRoot)
	for slot := 0; slot < paths.SlotCount; slot++ {
		fmt.Fprintf(&b, "d %s/%d 0750 gdgagent-svc gdgagent-run-%d -\n", paths.SpecRunRoot, slot, slot)
	}
	tmp, err := os.CreateTemp(dir, ".gdg-agent.tmp.")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(b.String()); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, 0o444); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, filepath.Join(dir, "gdg-agent.conf"))
}

func mergeSlotMCP(baseJSON, extraJSON []byte) ([]byte, error) {
	var base mcpFile
	var extra mcpFile
	if err := json.Unmarshal(baseJSON, &base); err != nil || base.MCPServers == nil {
		return nil, fmt.Errorf("base mcp.json missing mcpServers")
	}
	if err := json.Unmarshal(extraJSON, &extra); err != nil || extra.MCPServers == nil {
		return nil, fmt.Errorf("extra mcp.json missing mcpServers")
	}
	merged := mcpFile{MCPServers: map[string]mcpServer{}}
	for name, server := range extra.MCPServers {
		merged.MCPServers[name] = server
	}
	for name, server := range base.MCPServers {
		merged.MCPServers[name] = server
	}
	out, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}

func reconcileDecommissioned(paths layoutPaths) error {
	entries, err := os.ReadDir(filepath.Join(paths.AgentRoot, "bin"))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "spawn-slot-") {
			continue
		}
		idx, convErr := strconv.Atoi(strings.TrimPrefix(name, "spawn-slot-"))
		if convErr != nil {
			continue
		}
		if idx >= paths.SlotCount {
			if err := os.Remove(filepath.Join(paths.AgentRoot, "bin", name)); err != nil {
				return err
			}
		}
	}

	runEntries, err := os.ReadDir(paths.RunRoot)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range runEntries {
		if !entry.IsDir() {
			continue
		}
		idx, convErr := strconv.Atoi(entry.Name())
		if convErr != nil {
			continue
		}
		if idx >= paths.SlotCount {
			if err := os.RemoveAll(filepath.Join(paths.RunRoot, entry.Name())); err != nil {
				return err
			}
		}
	}

	homeEntries, err := os.ReadDir(paths.HomeRoot)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for _, entry := range homeEntries {
		if !entry.IsDir() {
			continue
		}
		if !strings.HasPrefix(entry.Name(), "gdgagent-run-") {
			continue
		}
		idx, convErr := strconv.Atoi(strings.TrimPrefix(entry.Name(), "gdgagent-run-"))
		if convErr != nil {
			continue
		}
		if idx >= paths.SlotCount {
			if err := os.RemoveAll(filepath.Join(paths.HomeRoot, entry.Name(), ".cursor")); err != nil {
				return err
			}
		}
	}
	return nil
}

func maybeChownWiki(wikiRoot string) error {
	if _, err := user.Lookup("gdgagent-svc"); err != nil {
		return nil
	}
	if _, err := user.LookupGroup("gdgwiki"); err != nil {
		return nil
	}
	svc, err := user.Lookup("gdgagent-svc")
	if err != nil {
		return err
	}
	grp, err := user.LookupGroup("gdgwiki")
	if err != nil {
		return err
	}
	uid, _ := strconv.Atoi(svc.Uid)
	gid, _ := strconv.Atoi(grp.Gid)
	return os.Chown(wikiRoot, uid, gid)
}

func subst(s, agentRoot, runSlotDir, indexSocket string) string {
	s = strings.ReplaceAll(s, "__AGENT_ROOT__", agentRoot)
	s = strings.ReplaceAll(s, "/opt/gdg-agent", agentRoot)
	if runSlotDir != "" {
		s = strings.ReplaceAll(s, "__RUN_SLOT_DIR__", runSlotDir)
	}
	if indexSocket != "" {
		s = strings.ReplaceAll(s, "__INDEX_SOCKET__", indexSocket)
	}
	return s
}

func lookVisudo() string {
	if path, err := exec.LookPath("visudo"); err == nil {
		return path
	}
	if info, err := os.Stat("/usr/sbin/visudo"); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
		return "/usr/sbin/visudo"
	}
	return ""
}

func mkdirMode(path string, unixMode uint32) error {
	mode := unixFileMode(unixMode)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.Mkdir(path, mode); err != nil && !os.IsExist(err) {
		return err
	}
	return os.Chmod(path, mode)
}

func unixFileMode(unix uint32) os.FileMode {
	mode := os.FileMode(unix & 0o777)
	if unix&0o1000 != 0 {
		mode |= os.ModeSticky
	}
	if unix&0o2000 != 0 {
		mode |= os.ModeSetgid
	}
	if unix&0o4000 != 0 {
		mode |= os.ModeSetuid
	}
	return mode
}

func writeFile(path string, data []byte, unixMode uint32) error {
	mode := unixFileMode(unixMode)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		_ = os.Chmod(path, mode|0o200)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, path)
}
