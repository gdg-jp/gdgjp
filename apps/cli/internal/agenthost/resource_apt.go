package agenthost

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// AptResource ensures system debian/ubuntu packages are installed.
type AptResource struct {
	Packages     []string
	EnsureNode   bool
	NodeMajor    int
	NodeMinMinor int
	Prefix       string
}

func (a *AptResource) ID() string {
	return "apt-packages"
}

func (a *AptResource) ResourceType() string {
	return "apt"
}

func (a *AptResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   a.ID(),
		ResourceType: a.ResourceType(),
		Action:       ActionNone,
	}

	if a.Prefix != "" {
		return ch, nil
	}

	var missing []string
	for _, pkg := range a.Packages {
		if !isDebianPackageInstalled(pkg) {
			missing = append(missing, pkg)
		}
	}

	if a.EnsureNode && !isNodeVersionOk(a.NodeMajor, a.NodeMinMinor) {
		missing = append(missing, fmt.Sprintf("nodejs (>= %d.%d.0)", a.NodeMajor, a.NodeMinMinor))
	}

	if len(missing) > 0 {
		ch.Action = ActionUpdate
		ch.Diff = fmt.Sprintf("+ install packages: %s", strings.Join(missing, ", "))
		return ch, nil
	}

	return ch, nil
}

func (a *AptResource) Apply(ctx context.Context, c Change) error {
	if a.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	if a.EnsureNode && !isNodeVersionOk(a.NodeMajor, a.NodeMinMinor) {
		// Securely configure NodeSource signed repository without curl | bash
		if err := os.MkdirAll("/etc/apt/keyrings", 0o755); err != nil {
			return fmt.Errorf("failed to create /etc/apt/keyrings: %w", err)
		}

		keyURL := "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key"
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, keyURL, nil)
		if err != nil {
			return err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return fmt.Errorf("failed to fetch nodesource gpg key from %s: %w", keyURL, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to fetch nodesource gpg key: status %s", resp.Status)
		}
		keyBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("reading nodesource gpg key failed: %w", err)
		}

		keyPath := "/etc/apt/keyrings/nodesource.asc"
		if err := os.WriteFile(keyPath, keyBytes, 0o644); err != nil {
			return fmt.Errorf("writing %s failed: %w", keyPath, err)
		}

		sourcesList := fmt.Sprintf("deb [signed-by=%s] https://deb.nodesource.com/node_%d.x nodistro main\n", keyPath, a.NodeMajor)
		if err := os.WriteFile("/etc/apt/sources.list.d/nodesource.list", []byte(sourcesList), 0o644); err != nil {
			return fmt.Errorf("writing nodesource.list failed: %w", err)
		}

		updateCmd := exec.CommandContext(ctx, "apt-get", "update", "-qq")
		updateCmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
		if out, err := updateCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("apt-get update after nodesource repo configuration failed: %w (%s)", err, string(out))
		}

		installNode := exec.CommandContext(ctx, "apt-get", "install", "-y", "-qq", "nodejs")
		installNode.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
		if out, err := installNode.CombinedOutput(); err != nil {
			return fmt.Errorf("apt-get install nodejs failed: %w (%s)", err, string(out))
		}
	}

	var toInstall []string
	for _, pkg := range a.Packages {
		if !isDebianPackageInstalled(pkg) {
			toInstall = append(toInstall, pkg)
		}
	}

	if len(toInstall) > 0 {
		updateCmd := exec.Command("apt-get", "update", "-qq")
		updateCmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
		_ = updateCmd.Run()

		args := append([]string{"install", "-y", "-qq"}, toInstall...)
		installCmd := exec.Command("apt-get", args...)
		installCmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
		if out, err := installCmd.CombinedOutput(); err != nil {
			return fmt.Errorf("apt-get install failed: %w (%s)", err, string(out))
		}
	}

	return nil
}

func isDebianPackageInstalled(pkg string) bool {
	if _, err := exec.LookPath("dpkg-query"); err != nil {
		return true // skip if not dpkg-based system
	}
	cmd := exec.Command("dpkg-query", "-W", "-f=${Status}\n", pkg)
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "install ok installed")
}

func isNodeVersionOk(wantMajor, wantMinor int) bool {
	cmd := exec.Command("node", "-v")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	raw := strings.TrimPrefix(strings.TrimSpace(string(out)), "v")
	parts := strings.Split(raw, ".")
	if len(parts) < 2 {
		return false
	}
	major, err1 := strconv.Atoi(parts[0])
	minor, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return false
	}
	return major > wantMajor || (major == wantMajor && minor >= wantMinor)
}
