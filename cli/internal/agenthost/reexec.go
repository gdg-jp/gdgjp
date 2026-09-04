package agenthost

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

// ReexecFunc defines the function signature for executing a replacement process.
type ReexecFunc func(bin string, args []string) error

// DefaultReexec performs live process replacement via syscall.Exec.
var DefaultReexec ReexecFunc = func(bin string, args []string) error {
	return syscall.Exec(bin, args, os.Environ())
}

// CheckAndReexecSelf checks if currentVersion matches the spec's pinned gdgCli version.
// If mismatched in non-dev mode (or if forced), downloads the pinned binary, installs it,
// and re-execs the process before convergence begins.
func CheckAndReexecSelf(ctx context.Context, currentVersion string, specPins GdgCliPin, args []string, reexecFn ReexecFunc) error {
	if reexecFn == nil {
		reexecFn = DefaultReexec
	}

	if currentVersion == "dev" && os.Getenv("GDG_FORCE_REEXEC") != "1" {
		return nil
	}

	if specPins.Version == "" || currentVersion == specPins.Version {
		return nil
	}

	arch := runtime.GOARCH
	var archKey, assetArch string
	switch arch {
	case "amd64":
		archKey = "x86_64"
		assetArch = "amd64"
	case "arm64":
		archKey = "aarch64"
		assetArch = "arm64"
	default:
		return fmt.Errorf("unsupported arch for gdg re-exec: %s", arch)
	}

	expectedSHA := specPins.SHA256[archKey]
	assetTemplate := specPins.AssetTemplate
	if assetTemplate == "" {
		assetTemplate = "gdg_{version}_linux_{arch}.zip"
	}
	asset := strings.ReplaceAll(assetTemplate, "{version}", specPins.Version)
	asset = strings.ReplaceAll(asset, "{arch}", assetArch)

	url := fmt.Sprintf("https://github.com/gdg-jp/gdgjp/releases/download/cli/v%s/%s", specPins.Version, asset)
	fmt.Printf("==> self-update: re-executing with pinned gdg %s from %s\n", specPins.Version, url)

	if hook := os.Getenv("GDG_REEXEC_TEST_HOOK"); hook != "" {
		fmt.Printf("test reexec hook triggered: version %s -> %s\n", currentVersion, specPins.Version)
		return reexecFn("/usr/local/bin/gdg", args)
	}

	tmpDir, err := os.MkdirTemp("", "gdg-reexec-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	zipPath := filepath.Join(tmpDir, asset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s failed: status %s", url, resp.Status)
	}

	hasher := sha256.New()
	f, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(io.MultiWriter(f, hasher), resp.Body); err != nil {
		f.Close()
		return err
	}
	f.Close()

	if expectedSHA == "" {
		return fmt.Errorf("missing expected sha256 checksum for gdg re-exec arch %s", archKey)
	}
	actualSHA := hex.EncodeToString(hasher.Sum(nil))
	if actualSHA != expectedSHA {
		return fmt.Errorf("checksum mismatch for gdg: expected %s, got %s", expectedSHA, actualSHA)
	}

	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	dest := "/usr/local/bin/gdg"
	found := false
	for _, zf := range r.File {
		if zf.Name == "gdg" {
			rc, err := zf.Open()
			if err != nil {
				return err
			}
			tmpBin := filepath.Join(tmpDir, "gdg")
			bf, err := os.OpenFile(tmpBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				rc.Close()
				return err
			}
			_, copyErr := io.Copy(bf, rc)
			bf.Close()
			rc.Close()
			if copyErr != nil {
				return copyErr
			}
			if err := os.Rename(tmpBin, dest); err != nil {
				return fmt.Errorf("installing %s failed: %w", dest, err)
			}
			_ = os.Remove("/usr/local/bin/git-remote-gdg-wiki")
			_ = os.Symlink(dest, "/usr/local/bin/git-remote-gdg-wiki")
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("binary gdg not found in downloaded archive %s", asset)
	}

	return reexecFn(dest, args)
}
