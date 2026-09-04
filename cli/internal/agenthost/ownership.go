package agenthost

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

// ApplyOwnership performs live-path chown/chmod/apparmor/tmpfiles/linger.
// Prefix mode and non-root invocations are no-ops, matching apply-ownership.sh.
func ApplyOwnership(paths layoutPaths) error {
	if paths.Prefix != "" || os.Getuid() != 0 {
		return nil
	}
	fmt.Println("==> ownership + linger")
	if err := chownRecursive(paths.AgentRoot, "root", "root"); err != nil {
		return err
	}
	if err := chmodTree(filepath.Join(paths.AgentRoot, "lib"), 0o444); err != nil {
		return err
	}
	if err := os.Chmod(filepath.Join(paths.AgentRoot, "package.json"), 0o444); err != nil {
		return err
	}
	for _, p := range []string{
		paths.AgentRoot,
		filepath.Join(paths.AgentRoot, "bin"),
		filepath.Join(paths.AgentRoot, "lib"),
	} {
		if err := os.Chmod(p, 0o755); err != nil {
			return err
		}
	}
	_ = os.Chmod(filepath.Join(paths.AgentRoot, "bin", "wk"), 0o755)
	_ = os.Chmod(filepath.Join(paths.AgentRoot, "bin", "index-proxy"), 0o755)
	entries, _ := os.ReadDir(filepath.Join(paths.AgentRoot, "bin"))
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "spawn-slot-") {
			_ = os.Chmod(filepath.Join(paths.AgentRoot, "bin", entry.Name()), 0o755)
		}
	}

	if err := installDir(paths.WikiRoot, 0o2770, "gdgagent-svc", "gdgwiki"); err != nil {
		return err
	}
	if err := chgrpRecursive(paths.WikiRoot, "gdgwiki"); err != nil {
		return err
	}
	if err := chmodDirs(paths.WikiRoot, 0o2770); err != nil {
		return err
	}
	if err := installDir(paths.RunRoot, 0o755, "gdgagent-svc", "gdgagent-svc"); err != nil {
		return err
	}

	for slot := 0; slot < paths.SlotCount; slot++ {
		runUser := "gdgagent-run-" + strconv.Itoa(slot)
		home := "/home/" + runUser
		if err := installDir(home, 0o750, "root", runUser); err != nil {
			return err
		}
		if err := installDir(filepath.Join(home, ".config/cursor"), 0o700, runUser, runUser); err != nil {
			return err
		}
		if err := installDir(filepath.Join(home, ".cache"), 0o700, runUser, runUser); err != nil {
			return err
		}
		if err := installDir(filepath.Join(home, ".local/share"), 0o700, runUser, runUser); err != nil {
			return err
		}
		if err := installDir(filepath.Join(home, ".cursor"), 0o1775, "root", runUser); err != nil {
			return err
		}
		if err := installDir(filepath.Join(home, ".cursor/projects"), 0o755, runUser, runUser); err != nil {
			return err
		}
		for _, name := range []string{"hooks.json", "sandbox.json", "mcp.json", "permissions.json"} {
			p := filepath.Join(home, ".cursor", name)
			if err := chownPath(p, "root", "root"); err != nil {
				return err
			}
			if err := os.Chmod(p, 0o444); err != nil {
				return err
			}
		}
		cliConfig := filepath.Join(home, ".cursor/cli-config.json")
		if err := chownPath(cliConfig, runUser, runUser); err != nil {
			return err
		}
		if err := os.Chmod(cliConfig, 0o644); err != nil {
			return err
		}
		if err := installDir(filepath.Join(paths.RunRoot, strconv.Itoa(slot)), 0o750, "gdgagent-svc", runUser); err != nil {
			return err
		}
	}

	if err := installDir("/home/gdgagent-svc/.config/gdg", 0o700, "gdgagent-svc", "gdgagent-svc"); err != nil {
		return err
	}
	if err := installDir("/home/gdgagent-svc/.config/xangi", 0o700, "gdgagent-svc", "gdgagent-svc"); err != nil {
		return err
	}
	sudoers := "/etc/sudoers.d/gdg-agent"
	if err := os.Chmod(sudoers, 0o440); err != nil {
		return err
	}
	visudo := lookVisudo()
	if visudo == "" {
		return fmt.Errorf("visudo is required")
	}
	if out, err := exec.Command(visudo, "-c", "-f", sudoers).CombinedOutput(); err != nil {
		return fmt.Errorf("visudo -c failed: %s", out)
	}
	tmpfiles := "/etc/tmpfiles.d/gdg-agent.conf"
	if err := exec.Command("systemd-tmpfiles", "--create", tmpfiles).Run(); err != nil {
		return fmt.Errorf("systemd-tmpfiles: %w", err)
	}

	apparmor, err := configBytes("apparmor.d-cursor-agent-cursorsandbox")
	if err == nil && len(apparmor) > 0 {
		dst := "/etc/apparmor.d/cursor-agent-cursorsandbox"
		if writeErr := writeFile(dst, apparmor, 0o444); writeErr != nil {
			return writeErr
		}
		if path, lookErr := exec.LookPath("apparmor_parser"); lookErr == nil {
			if out, runErr := exec.Command(path, "-r", dst).CombinedOutput(); runErr != nil {
				return fmt.Errorf("apparmor_parser: %s", out)
			}
		}
	}
	_ = exec.Command("loginctl", "enable-linger", "gdgagent-svc").Run()
	return nil
}

func lookupIDs(userName, groupName string) (int, int, error) {
	u, err := user.Lookup(userName)
	if err != nil {
		return 0, 0, err
	}
	g, err := user.LookupGroup(groupName)
	if err != nil {
		return 0, 0, err
	}
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return 0, 0, err
	}
	gid, err := strconv.Atoi(g.Gid)
	if err != nil {
		return 0, 0, err
	}
	return uid, gid, nil
}

func chownPath(path, userName, groupName string) error {
	uid, gid, err := lookupIDs(userName, groupName)
	if err != nil {
		return err
	}
	return os.Lchown(path, uid, gid)
}

func installDir(path string, unixMode uint32, userName, groupName string) error {
	if err := mkdirMode(path, unixMode); err != nil {
		return err
	}
	if err := chownPath(path, userName, groupName); err != nil {
		return err
	}
	return os.Chmod(path, unixFileMode(unixMode))
}

func chownRecursive(root, userName, groupName string) error {
	uid, gid, err := lookupIDs(userName, groupName)
	if err != nil {
		return err
	}
	return filepath.Walk(root, func(path string, _ os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		return os.Lchown(path, uid, gid)
	})
}

func chgrpRecursive(root, groupName string) error {
	g, err := user.LookupGroup(groupName)
	if err != nil {
		return err
	}
	gid, err := strconv.Atoi(g.Gid)
	if err != nil {
		return err
	}
	return filepath.Walk(root, func(path string, _ os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		return os.Lchown(path, -1, gid)
	})
}

func chmodTree(root string, unixMode uint32) error {
	mode := unixFileMode(unixMode)
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			return os.Chmod(path, mode)
		}
		return nil
	})
}

func chmodDirs(root string, unixMode uint32) error {
	mode := unixFileMode(unixMode)
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return os.Chmod(path, mode)
		}
		return nil
	})
}
