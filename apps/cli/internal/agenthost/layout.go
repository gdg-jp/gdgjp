package agenthost

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
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
	OverlayPath    string
	Prefix         string
	SlotCount      int
	ApplyOwnership bool
	Prune          bool
}

// EmitLayout writes the agent-host file tree by planning and applying host resources.
func EmitLayout(opts EmitOptions) error {
	spec, err := loadSpecWithOverlay(opts.SpecPath, opts.OverlayPath)
	if err != nil {
		return err
	}
	paths, err := resolveLayoutPaths(spec, opts.Prefix, opts.SlotCount)
	if err != nil {
		return err
	}

	plan, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:       opts.SpecPath,
		OverlayPath:    opts.OverlayPath,
		Prefix:         opts.Prefix,
		SlotCount:      paths.SlotCount,
		Prune:          true,
		ApplyOwnership: opts.ApplyOwnership,
	})
	if err != nil {
		return err
	}

	if err := ApplyPlan(context.Background(), plan, ApplyOptions{}); err != nil {
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

// RenderLayout renders the complete file layout tree into outDir without modifying host state.
func RenderLayout(specPath, overlayPath, outDir string, slotCount int) error {
	if outDir == "" {
		return fmt.Errorf("--out directory is required for render")
	}
	return EmitLayout(EmitOptions{
		SpecPath:       specPath,
		OverlayPath:    overlayPath,
		Prefix:         outDir,
		SlotCount:      slotCount,
		ApplyOwnership: false,
	})
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

func sprintf04o(unix uint32) string {
	const digits = "01234567"
	buf := [4]byte{'0', '0', '0', '0'}
	for i := 3; i >= 0; i-- {
		buf[i] = digits[unix&7]
		unix >>= 3
	}
	return string(buf[:])
}

func writeFile(path string, data []byte, unixMode uint32) error {
	res := &FileResource{
		Path: path,
		Data: data,
		Mode: unixFileMode(unixMode),
	}
	return res.Apply(context.Background(), Change{
		ResourceID:   path,
		ResourceType: "file",
		Action:       ActionCreate,
	})
}
