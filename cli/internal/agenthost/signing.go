package agenthost

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const (
	DefaultMaxEntryCount       = 5000
	DefaultMaxUncompressedSize = 100 * 1024 * 1024 // 100 MB
)

// ArchiveInfo records the archive container attributes.
type ArchiveInfo struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

// ManifestEnvelope is the detached envelope describing a workspace or release bundle.
type ManifestEnvelope struct {
	Version          string            `json:"version"`
	Type             string            `json:"type,omitempty"` // "workspace" or "release"
	Archive          ArchiveInfo       `json:"archive"`
	Entries          map[string]string `json:"entries"`
	EntryCount       int               `json:"entryCount"`
	UncompressedSize int64             `json:"uncompressedSize"`
}

// ParsePublicKey parses a 32-byte Ed25519 public key from either raw bytes or a hex string.
func ParsePublicKey(raw []byte) (ed25519.PublicKey, error) {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) == 64 {
		decoded, err := hex.DecodeString(trimmed)
		if err == nil && len(decoded) == ed25519.PublicKeySize {
			return ed25519.PublicKey(decoded), nil
		}
	}
	if len(raw) == ed25519.PublicKeySize {
		return ed25519.PublicKey(raw), nil
	}
	return nil, fmt.Errorf("invalid ed25519 public key: expected 32 raw bytes or 64 hex characters (got %d bytes)", len(raw))
}

// ParseSignature parses a 64-byte Ed25519 signature from raw bytes or a hex string.
func ParseSignature(raw []byte) ([]byte, error) {
	trimmed := strings.TrimSpace(string(raw))
	if len(trimmed) == 128 {
		decoded, err := hex.DecodeString(trimmed)
		if err == nil && len(decoded) == ed25519.SignatureSize {
			return decoded, nil
		}
	}
	if len(raw) == ed25519.SignatureSize {
		return raw, nil
	}
	return nil, fmt.Errorf("invalid ed25519 signature: expected 64 raw bytes or 128 hex characters (got %d bytes)", len(raw))
}

// VerifyEnvelopeSignature strictly verifies the Ed25519 signature over manifest bytes.
// It never inspects or touches the archive.
func VerifyEnvelopeSignature(manifestRaw, sigRaw []byte, pubKey ed25519.PublicKey) error {
	if len(manifestRaw) == 0 {
		return errors.New("manifest envelope is empty")
	}
	if len(sigRaw) == 0 {
		return errors.New("missing signature: bundle must be verified with detached ed25519 signature")
	}
	if len(pubKey) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size: %d", len(pubKey))
	}

	sig, err := ParseSignature(sigRaw)
	if err != nil {
		return fmt.Errorf("invalid signature format: %w", err)
	}

	if !ed25519.Verify(pubKey, manifestRaw, sig) {
		return errors.New("ed25519 signature verification failed: manifest signature mismatch")
	}
	return nil
}

// ParseManifestEnvelope parses and basic-validates a manifest envelope JSON.
func ParseManifestEnvelope(raw []byte) (ManifestEnvelope, error) {
	var env ManifestEnvelope
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&env); err != nil {
		return env, fmt.Errorf("malformed manifest envelope: %w", err)
	}
	if env.Archive.Name == "" {
		return env, errors.New("manifest archive.name is required")
	}
	if env.Archive.Size <= 0 {
		return env, errors.New("manifest archive.size must be positive")
	}
	if len(env.Archive.SHA256) != 64 {
		return env, errors.New("manifest archive.sha256 must be a 64-character hex string")
	}
	if env.EntryCount < 0 {
		return env, errors.New("manifest entryCount cannot be negative")
	}
	if env.UncompressedSize < 0 {
		return env, errors.New("manifest uncompressedSize cannot be negative")
	}
	if env.Entries == nil {
		env.Entries = make(map[string]string)
	}
	return env, nil
}

// ExtractArchiveSafely performs defensive entry-by-entry extraction of tar.gz archive
// using the verified envelope as an allowlist and bounds limit.
func ExtractArchiveSafely(archivePath, targetDir string, envelope ManifestEnvelope, maxEntries int, maxSize int64) error {
	if maxEntries <= 0 {
		maxEntries = DefaultMaxEntryCount
	}
	if maxSize <= 0 {
		maxSize = DefaultMaxUncompressedSize
	}

	// 1. Bound check from envelope
	if envelope.EntryCount > maxEntries {
		return fmt.Errorf("archive entry count %d exceeds maximum allowed %d", envelope.EntryCount, maxEntries)
	}
	if envelope.UncompressedSize > maxSize {
		return fmt.Errorf("archive uncompressed size %d exceeds maximum allowed %d bytes", envelope.UncompressedSize, maxSize)
	}

	// 2. Stat and verify real archive file size
	fi, err := os.Stat(archivePath)
	if err != nil {
		return fmt.Errorf("cannot stat archive %s: %w", archivePath, err)
	}
	if fi.Size() != envelope.Archive.Size {
		return fmt.Errorf("archive size mismatch: got %d bytes, manifest declares %d", fi.Size(), envelope.Archive.Size)
	}

	// 3. Verify archive whole-file digest
	f, err := os.Open(archivePath)
	if err != nil {
		return fmt.Errorf("open archive: %w", err)
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return fmt.Errorf("hash archive: %w", err)
	}
	archiveSum := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(archiveSum, envelope.Archive.SHA256) {
		return fmt.Errorf("archive digest mismatch: got %s, manifest expects %s", archiveSum, envelope.Archive.SHA256)
	}

	// Rewind for extraction
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("rewind archive: %w", err)
	}

	gzReader, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Build set of permitted directory prefixes from declared manifest entries
	allowedDirs := make(map[string]bool)
	for entryPath := range envelope.Entries {
		d := path.Dir(entryPath)
		for d != "." && d != "/" && d != "" {
			allowedDirs[d] = true
			d = path.Dir(d)
		}
	}

	tarReader := tar.NewReader(gzReader)
	seen := make(map[string]bool)
	var totalBytes int64
	var fileCount int
	var entryCount int

	for {
		hdr, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("tar read error: %w", err)
		}

		entryCount++
		if entryCount > maxEntries || (envelope.EntryCount > 0 && entryCount > envelope.EntryCount) {
			return fmt.Errorf("archive exceeded entry count limit (%d entries)", entryCount)
		}

		rawPath := hdr.Name
		// 4. Defend against path traversal and absolute paths
		if strings.HasPrefix(rawPath, "/") || strings.HasPrefix(rawPath, "\\") {
			return fmt.Errorf("archive entry has forbidden absolute path: %q", rawPath)
		}

		cleanPath := path.Clean(strings.ReplaceAll(rawPath, "\\", "/"))
		if strings.HasPrefix(cleanPath, "/") || strings.HasPrefix(cleanPath, "../") || cleanPath == ".." || strings.Contains(cleanPath, "/../") {
			return fmt.Errorf("archive entry attempts path traversal: %q", rawPath)
		}

		// 5. Defend against duplicate entries
		if seen[cleanPath] {
			return fmt.Errorf("duplicate archive entry: %q", cleanPath)
		}
		seen[cleanPath] = true

		if cleanPath == "." {
			continue
		}

		// 6. Defend against non-regular file types
		switch hdr.Typeflag {
		case tar.TypeDir:
			// Enforce allowlist: directory must be an ancestor of a declared manifest entry
			if !allowedDirs[cleanPath] {
				return fmt.Errorf("archive directory entry %q is not an ancestor of any manifest entry", cleanPath)
			}
			dest := filepath.Join(targetDir, filepath.FromSlash(cleanPath))
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return fmt.Errorf("mkdir %s: %w", dest, err)
			}
			continue

		case tar.TypeReg, tar.TypeRegA:
			// Regular files only
		case tar.TypeSymlink:
			return fmt.Errorf("forbidden symlink in archive: %q -> %q", cleanPath, hdr.Linkname)
		case tar.TypeLink:
			return fmt.Errorf("forbidden hard link in archive: %q -> %q", cleanPath, hdr.Linkname)
		case tar.TypeChar, tar.TypeBlock, tar.TypeFifo:
			return fmt.Errorf("forbidden device or fifo in archive: %q", cleanPath)
		default:
			return fmt.Errorf("forbidden entry type %d in archive: %q", hdr.Typeflag, cleanPath)
		}

		// 7. Enforce allowlist: entry must exist in envelope.Entries
		expectedHash, ok := envelope.Entries[cleanPath]
		if !ok {
			return fmt.Errorf("archive entry %q is not present in manifest allowlist", cleanPath)
		}

		fileCount++
		if fileCount > maxEntries || (envelope.EntryCount > 0 && fileCount > envelope.EntryCount) {
			return fmt.Errorf("archive exceeded entry count limit (%d files extracted)", fileCount)
		}

		destPath := filepath.Join(targetDir, filepath.FromSlash(cleanPath))
		destDir := filepath.Dir(destPath)
		if err := os.MkdirAll(destDir, 0o755); err != nil {
			return fmt.Errorf("mkdir parent %s: %w", destDir, err)
		}

		// Write to temporary file in same directory first
		tmpFile, err := os.CreateTemp(destDir, ".extract-*")
		if err != nil {
			return fmt.Errorf("create temp file: %w", err)
		}
		tmpPath := tmpFile.Name()

		fileHasher := sha256.New()
		writer := io.MultiWriter(tmpFile, fileHasher)

		// Limit reader bounded by uncompressed size limit
		remaining := maxSize - totalBytes
		if remaining < 0 {
			remaining = 0
		}
		lr := io.LimitReader(tarReader, remaining+1)

		written, copyErr := io.Copy(writer, lr)
		closeErr := tmpFile.Close()

		if copyErr != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("failed writing entry %s: %w", cleanPath, copyErr)
		}
		if closeErr != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("failed closing temp file for %s: %w", cleanPath, closeErr)
		}

		totalBytes += written
		if totalBytes > maxSize || (envelope.UncompressedSize > 0 && totalBytes > envelope.UncompressedSize) {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("archive exceeded uncompressed size limit (%d bytes)", totalBytes)
		}

		actualHash := hex.EncodeToString(fileHasher.Sum(nil))
		if !strings.EqualFold(actualHash, expectedHash) {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("per-file digest mismatch for %q: got %s, manifest expects %s", cleanPath, actualHash, expectedHash)
		}

		mode := os.FileMode(hdr.Mode) & 0o777
		if mode == 0 {
			mode = 0o644
		}
		if err := os.Chmod(tmpPath, mode); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("chmod %s: %w", destPath, err)
		}

		if err := os.Rename(tmpPath, destPath); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("rename %s -> %s: %w", tmpPath, destPath, err)
		}
	}

	// 8. Verify completeness: all entries in manifest were extracted
	for entryPath := range envelope.Entries {
		if !seen[entryPath] {
			return fmt.Errorf("manifest entry missing from archive: %q", entryPath)
		}
	}

	return nil
}
