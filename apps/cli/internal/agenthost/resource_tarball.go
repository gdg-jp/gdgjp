package agenthost

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// TarballResource downloads, validates, extracts, and verifies a binary package.
type TarballResource struct {
	Name          string
	Destination   string
	Symlink       string
	Version       string
	SHA256        map[string]string
	URLTemplate   string
	VerifyCmd     []string
	VerifyPattern string
	ExtractMode   string // "binary" (extract single binary) or "dir" (extract full directory)
	TargetDir     string // directory for "dir" extract mode
	Prefix        string
}

func (t *TarballResource) ID() string {
	return t.Name
}

func (t *TarballResource) ResourceType() string {
	return "tarball"
}

func (t *TarballResource) Plan(ctx context.Context) (Change, error) {
	ch := Change{
		ResourceID:   t.ID(),
		ResourceType: t.ResourceType(),
		Action:       ActionNone,
	}

	if t.Prefix != "" {
		return ch, nil
	}

	target := t.Destination
	if t.Symlink != "" {
		target = t.Symlink
	}

	if _, err := os.Stat(target); err != nil {
		if os.IsNotExist(err) {
			ch.Action = ActionCreate
			ch.Diff = fmt.Sprintf("+ install %s %s to %s", t.Name, t.Version, t.Destination)
			return ch, nil
		}
		return ch, err
	}

	if len(t.VerifyCmd) > 0 {
		out, err := exec.Command(t.VerifyCmd[0], t.VerifyCmd[1:]...).CombinedOutput()
		if err != nil || !strings.Contains(string(out), t.VerifyPattern) {
			ch.Action = ActionUpdate
			ch.Diff = fmt.Sprintf("~ upgrade %s: output %q does not match expected %q", t.Name, strings.TrimSpace(string(out)), t.VerifyPattern)
			return ch, nil
		}
	}

	return ch, nil
}

func (t *TarballResource) Apply(ctx context.Context, c Change) error {
	if t.Prefix != "" || os.Getuid() != 0 {
		return nil
	}

	arch := runtime.GOARCH
	var archKey, assetArch string
	switch arch {
	case "amd64":
		archKey = "x86_64"
		assetArch = "x64"
	case "arm64":
		archKey = "aarch64"
		assetArch = "arm64"
	default:
		return fmt.Errorf("unsupported architecture for %s: %s", t.Name, arch)
	}

	expectedSHA, ok := t.SHA256[archKey]
	if !ok || expectedSHA == "" {
		return fmt.Errorf("no sha256 checksum for %s on %s", t.Name, archKey)
	}

	url := strings.ReplaceAll(t.URLTemplate, "{version}", t.Version)
	url = strings.ReplaceAll(url, "{arch}", archKey)
	url = strings.ReplaceAll(url, "{cursor_arch}", assetArch)

	fmt.Printf("==> downloading %s %s from %s\n", t.Name, t.Version, url)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("download %s failed: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s failed with status %s", url, resp.Status)
	}

	tmpDir, err := os.MkdirTemp("", t.Name+"-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	archivePath := filepath.Join(tmpDir, "package.tar.gz")
	f, err := os.Create(archivePath)
	if err != nil {
		return err
	}

	hasher := sha256.New()
	w := io.MultiWriter(f, hasher)
	if _, err := io.Copy(w, resp.Body); err != nil {
		f.Close()
		return err
	}
	f.Close()

	actualSHA := hex.EncodeToString(hasher.Sum(nil))
	if actualSHA != expectedSHA {
		return fmt.Errorf("checksum mismatch for %s: expected %s, got %s", t.Name, expectedSHA, actualSHA)
	}

	var oldBackup string
	var cleanupBackup func()
	var rollback func()

	if t.ExtractMode == "dir" {
		destDir := t.TargetDir
		if destDir == "" {
			destDir = filepath.Dir(t.Destination)
		}
		parentDir := filepath.Dir(destDir)
		if err := os.MkdirAll(parentDir, 0o755); err != nil {
			return err
		}
		tempDestDir, err := os.MkdirTemp(parentDir, filepath.Base(destDir)+".extract-*")
		if err != nil {
			return err
		}
		defer os.RemoveAll(tempDestDir)

		if err := extractTarGzDir(archivePath, tempDestDir, 1); err != nil {
			return fmt.Errorf("extracting %s failed: %w", t.Name, err)
		}

		// Pre-verify candidate binary from temporary extraction location if candidate binary exists
		candidateBin := filepath.Join(tempDestDir, filepath.Base(t.Destination))
		if _, err := os.Stat(candidateBin); err == nil && len(t.VerifyCmd) > 1 && t.VerifyPattern != "" {
			out, err := exec.Command(candidateBin, t.VerifyCmd[1:]...).CombinedOutput()
			if err != nil || !strings.Contains(string(out), t.VerifyPattern) {
				return fmt.Errorf("candidate verification failed for %s from temp location %s: got %q, expected %q (err: %v)", t.Name, candidateBin, strings.TrimSpace(string(out)), t.VerifyPattern, err)
			}
		}

		// Stage backup of existing directory
		oldBackup = destDir + ".old"
		hasOld := false
		if _, err := os.Stat(destDir); err == nil {
			hasOld = true
			_ = os.RemoveAll(oldBackup)
			if err := os.Rename(destDir, oldBackup); err != nil {
				return fmt.Errorf("backing up existing %s failed: %w", destDir, err)
			}
		}

		if err := os.Rename(tempDestDir, destDir); err != nil {
			if hasOld {
				_ = os.Rename(oldBackup, destDir)
			}
			return fmt.Errorf("swapping extracted directory for %s failed: %w", t.Name, err)
		}

		rollback = func() {
			if hasOld {
				_ = os.RemoveAll(destDir)
				_ = os.Rename(oldBackup, destDir)
			}
		}
		cleanupBackup = func() {
			if hasOld {
				_ = os.RemoveAll(oldBackup)
			}
		}
	} else {
		// Single binary extract (e.g. gws)
		if err := os.MkdirAll(filepath.Dir(t.Destination), 0o755); err != nil {
			return err
		}
		tempBin := t.Destination + ".tmp"
		defer os.Remove(tempBin)

		if err := extractTarGzBinary(archivePath, t.Name, tempBin); err != nil {
			return fmt.Errorf("extracting binary %s failed: %w", t.Name, err)
		}

		// Pre-verify candidate binary from temporary location if applicable
		if len(t.VerifyCmd) > 1 && t.VerifyPattern != "" {
			out, err := exec.Command(tempBin, t.VerifyCmd[1:]...).CombinedOutput()
			if err != nil || !strings.Contains(string(out), t.VerifyPattern) {
				return fmt.Errorf("candidate verification failed for %s from temp location: got %q, expected %q (err: %v)", t.Name, strings.TrimSpace(string(out)), t.VerifyPattern, err)
			}
		}

		oldBackup = t.Destination + ".old"
		hasOld := false
		if _, err := os.Stat(t.Destination); err == nil {
			hasOld = true
			_ = os.Remove(oldBackup)
			if err := os.Rename(t.Destination, oldBackup); err != nil {
				return fmt.Errorf("backing up existing binary %s failed: %w", t.Destination, err)
			}
		}

		if err := os.Rename(tempBin, t.Destination); err != nil {
			if hasOld {
				_ = os.Rename(oldBackup, t.Destination)
			}
			return fmt.Errorf("swapping binary %s failed: %w", t.Destination, err)
		}

		rollback = func() {
			if hasOld {
				_ = os.Remove(t.Destination)
				_ = os.Rename(oldBackup, t.Destination)
			}
		}
		cleanupBackup = func() {
			if hasOld {
				_ = os.Remove(oldBackup)
			}
		}
	}

	if t.Symlink != "" {
		if err := os.MkdirAll(filepath.Dir(t.Symlink), 0o755); err != nil {
			if rollback != nil {
				rollback()
			}
			return err
		}
		_ = os.Remove(t.Symlink)
		if err := os.Symlink(t.Destination, t.Symlink); err != nil {
			if rollback != nil {
				rollback()
			}
			return fmt.Errorf("creating symlink %s -> %s: %w", t.Symlink, t.Destination, err)
		}
	}

	if len(t.VerifyCmd) > 0 {
		out, err := exec.Command(t.VerifyCmd[0], t.VerifyCmd[1:]...).CombinedOutput()
		if err != nil || !strings.Contains(string(out), t.VerifyPattern) {
			if rollback != nil {
				rollback()
			}
			return fmt.Errorf("verification failed for %s: got %q, expected %q (err: %v)", t.Name, strings.TrimSpace(string(out)), t.VerifyPattern, err)
		}
	}

	// All checks succeeded; safe to discard backup
	if cleanupBackup != nil {
		cleanupBackup()
	}
	return nil
}

func extractTarGzBinary(tarPath, binaryName, destPath string) error {
	f, err := os.Open(tarPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		cleanName := filepath.Clean(hdr.Name)
		if filepath.Base(cleanName) == binaryName {
			out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				os.Remove(destPath)
				return err
			}
			out.Close()
			return nil
		}
	}
	return fmt.Errorf("binary %s not found in archive", binaryName)
}

func extractTarGzDir(tarPath, destDir string, stripComponents int) error {
	f, err := os.Open(tarPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()

	cleanDest := filepath.Clean(destDir)
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		cleanHeader := filepath.Clean(hdr.Name)
		if filepath.IsAbs(hdr.Name) || strings.HasPrefix(hdr.Name, "/") || strings.HasPrefix(cleanHeader, "..") {
			return fmt.Errorf("insecure archive entry escapes destination directory: %q", hdr.Name)
		}

		parts := strings.Split(cleanHeader, string(os.PathSeparator))
		if len(parts) <= stripComponents {
			continue
		}
		rel := filepath.Join(parts[stripComponents:]...)
		target := filepath.Join(destDir, rel)
		cleanTarget := filepath.Clean(target)

		// Strict containment check to prevent zip/tar slip directory traversal
		if cleanTarget != cleanDest && !strings.HasPrefix(cleanTarget, cleanDest+string(os.PathSeparator)) {
			return fmt.Errorf("insecure archive entry escapes destination directory: %q", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(cleanTarget, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(cleanTarget), 0o755); err != nil {
				return err
			}
			mode := hdr.FileInfo().Mode()
			out, err := os.OpenFile(cleanTarget, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
	return nil
}
