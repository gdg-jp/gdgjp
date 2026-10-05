package agenthost

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createTestArchive(t *testing.T, entries []struct {
	Name     string
	Content  []byte
	Typeflag byte
	Linkname string
}) ([]byte, string, int64) {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	var uncompressedSize int64
	for _, e := range entries {
		hdr := &tar.Header{
			Name:     e.Name,
			Mode:     0o644,
			Size:     int64(len(e.Content)),
			Typeflag: e.Typeflag,
			Linkname: e.Linkname,
		}
		if hdr.Typeflag == 0 {
			hdr.Typeflag = tar.TypeReg
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatalf("WriteHeader failed: %v", err)
		}
		if len(e.Content) > 0 {
			if _, err := tw.Write(e.Content); err != nil {
				t.Fatalf("tar Write failed: %v", err)
			}
			uncompressedSize += int64(len(e.Content))
		}
	}

	if err := tw.Close(); err != nil {
		t.Fatalf("tw Close failed: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gw Close failed: %v", err)
	}

	raw := buf.Bytes()
	sum := sha256.Sum256(raw)
	return raw, hex.EncodeToString(sum[:]), uncompressedSize
}

func TestVerifyEnvelopeSignature(t *testing.T) {
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	manifestBytes := []byte(`{"version":"1.0.0","type":"workspace"}`)
	sig := ed25519.Sign(privKey, manifestBytes)

	// Valid signature
	if err := VerifyEnvelopeSignature(manifestBytes, sig, pubKey); err != nil {
		t.Fatalf("expected valid signature to pass: %v", err)
	}

	// Hex-encoded signature
	hexSig := []byte(hex.EncodeToString(sig))
	if err := VerifyEnvelopeSignature(manifestBytes, hexSig, pubKey); err != nil {
		t.Fatalf("expected valid hex signature to pass: %v", err)
	}

	// Altered manifest bytes
	tamperedManifest := []byte(`{"version":"1.0.1","type":"workspace"}`)
	if err := VerifyEnvelopeSignature(tamperedManifest, sig, pubKey); err == nil {
		t.Fatal("expected tampered manifest to fail verification")
	}

	// Missing / empty signature
	if err := VerifyEnvelopeSignature(manifestBytes, nil, pubKey); err == nil {
		t.Fatal("expected empty signature to fail verification")
	}

	// Wrong key
	pubKey2, _, _ := ed25519.GenerateKey(rand.Reader)
	if err := VerifyEnvelopeSignature(manifestBytes, sig, pubKey2); err == nil {
		t.Fatal("expected verification with wrong key to fail")
	}
}

func TestExtractArchiveSafely_Valid(t *testing.T) {
	tmpDir := t.TempDir()
	archivePath := filepath.Join(tmpDir, "test.tar.gz")
	targetDir := filepath.Join(tmpDir, "extracted")

	fileA := []byte("content of file A")
	hashA := hex.EncodeToString(sha256New(fileA))
	fileB := []byte("content of file B")
	hashB := hex.EncodeToString(sha256New(fileB))

	entries := []struct {
		Name     string
		Content  []byte
		Typeflag byte
		Linkname string
	}{
		{Name: "dir1", Typeflag: tar.TypeDir},
		{Name: "dir1/fileA.txt", Content: fileA, Typeflag: tar.TypeReg},
		{Name: "fileB.txt", Content: fileB, Typeflag: tar.TypeReg},
	}

	rawArchive, archiveSum, uncompSize := createTestArchive(t, entries)
	if err := os.WriteFile(archivePath, rawArchive, 0o644); err != nil {
		t.Fatal(err)
	}

	envelope := ManifestEnvelope{
		Version: "1.0.0",
		Archive: ArchiveInfo{
			Name:   "test.tar.gz",
			Size:   int64(len(rawArchive)),
			SHA256: archiveSum,
		},
		Entries: map[string]string{
			"dir1/fileA.txt": hashA,
			"fileB.txt":      hashB,
		},
		EntryCount:       3,
		UncompressedSize: uncompSize,
	}

	if err := ExtractArchiveSafely(archivePath, targetDir, envelope, 10, 1024*1024); err != nil {
		t.Fatalf("ExtractArchiveSafely failed: %v", err)
	}

	gotA, err := os.ReadFile(filepath.Join(targetDir, "dir1", "fileA.txt"))
	if err != nil || string(gotA) != string(fileA) {
		t.Fatalf("fileA mismatch: %s (err: %v)", gotA, err)
	}
	gotB, err := os.ReadFile(filepath.Join(targetDir, "fileB.txt"))
	if err != nil || string(gotB) != string(fileB) {
		t.Fatalf("fileB mismatch: %s (err: %v)", gotB, err)
	}
}

func TestExtractArchiveSafely_Defenses(t *testing.T) {
	testCases := []struct {
		name    string
		entries []struct {
			Name     string
			Content  []byte
			Typeflag byte
			Linkname string
		}
		setupEnv   func(raw []byte, sum string, size int64) ManifestEnvelope
		errSubstr  string
		maxEntries int
	}{
		{
			name: "path traversal with ../",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "../outside.txt", Content: []byte("evil"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"../outside.txt": hex.EncodeToString(sha256New([]byte("evil")))},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "path traversal",
		},
		{
			name: "absolute path with /",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "/etc/shadow", Content: []byte("evil"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"/etc/shadow": hex.EncodeToString(sha256New([]byte("evil")))},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "absolute path",
		},
		{
			name: "forbidden symlink",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "link.txt", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"link.txt": "dummy"},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "forbidden symlink",
		},
		{
			name: "forbidden hard link",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "hardlink.txt", Typeflag: tar.TypeLink, Linkname: "target.txt"},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"hardlink.txt": "dummy"},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "forbidden hard link",
		},
		{
			name: "forbidden FIFO device",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "myfifo", Typeflag: tar.TypeFifo},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"myfifo": "dummy"},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "forbidden device or fifo",
		},
		{
			name: "duplicate path",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "file.txt", Content: []byte("content1"), Typeflag: tar.TypeReg},
				{Name: "file.txt", Content: []byte("content2"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"file.txt": hex.EncodeToString(sha256New([]byte("content1")))},
					EntryCount:       2,
					UncompressedSize: size,
				}
			},
			errSubstr: "duplicate archive entry",
		},
		{
			name: "entry not in manifest allowlist",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "unannounced.txt", Content: []byte("stealth"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"other.txt": "dummy"},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "not present in manifest allowlist",
		},
		{
			name: "archive checksum mismatch",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "file.txt", Content: []byte("hello"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: strings.Repeat("a", 64)},
					Entries:          map[string]string{"file.txt": hex.EncodeToString(sha256New([]byte("hello")))},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "archive digest mismatch",
		},
		{
			name: "per-file content digest mismatch",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "file.txt", Content: []byte("actual"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"file.txt": strings.Repeat("f", 64)},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			errSubstr: "per-file digest mismatch",
		},
		{
			name: "exceeds maximum allowed entries limit",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "file1.txt", Content: []byte("1"), Typeflag: tar.TypeReg},
				{Name: "file2.txt", Content: []byte("2"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"file1.txt": hex.EncodeToString(sha256New([]byte("1"))), "file2.txt": hex.EncodeToString(sha256New([]byte("2")))},
					EntryCount:       20,
					UncompressedSize: size,
				}
			},
			errSubstr: "exceeds maximum allowed",
		},
		{
			name: "directory entry not an ancestor of any manifest entry",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "unrelated/dir", Typeflag: tar.TypeDir},
				{Name: "valid/file.txt", Content: []byte("content"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"valid/file.txt": hex.EncodeToString(sha256New([]byte("content")))},
					EntryCount:       2,
					UncompressedSize: size,
				}
			},
			errSubstr: "is not an ancestor of any manifest entry",
		},
		{
			name: "excessive directory entries exceed entry count limit",
			entries: []struct {
				Name     string
				Content  []byte
				Typeflag byte
				Linkname string
			}{
				{Name: "valid", Typeflag: tar.TypeDir},
				{Name: "valid/sub", Typeflag: tar.TypeDir},
				{Name: "valid/sub/file.txt", Content: []byte("ok"), Typeflag: tar.TypeReg},
			},
			setupEnv: func(raw []byte, sum string, size int64) ManifestEnvelope {
				return ManifestEnvelope{
					Archive:          ArchiveInfo{Name: "test.tar.gz", Size: int64(len(raw)), SHA256: sum},
					Entries:          map[string]string{"valid/sub/file.txt": hex.EncodeToString(sha256New([]byte("ok")))},
					EntryCount:       1,
					UncompressedSize: size,
				}
			},
			maxEntries: 10, // maxEntries is 10, but envelope.EntryCount: 1 bounds total archive entries
			errSubstr:  "archive exceeded entry count limit",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			archivePath := filepath.Join(tmpDir, "test.tar.gz")
			targetDir := filepath.Join(tmpDir, "extracted")

			rawArchive, sum, size := createTestArchive(t, tc.entries)
			if err := os.WriteFile(archivePath, rawArchive, 0o644); err != nil {
				t.Fatal(err)
			}

			env := tc.setupEnv(rawArchive, sum, size)
			maxEntries := 10
			if tc.maxEntries > 0 {
				maxEntries = tc.maxEntries
			} else if tc.name == "exceeds maximum allowed entries limit" {
				maxEntries = 5
			}
			err := ExtractArchiveSafely(archivePath, targetDir, env, maxEntries, 1024*1024)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.errSubstr)
			}
			if !strings.Contains(err.Error(), tc.errSubstr) {
				t.Fatalf("expected error containing %q, got: %v", tc.errSubstr, err)
			}
		})
	}
}

func sha256New(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

func TestParseManifestEnvelope(t *testing.T) {
	valid := []byte(`{
		"version": "1.0.0",
		"type": "workspace",
		"archive": {
			"name": "bundle.tar.gz",
			"size": 1234,
			"sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		},
		"entries": {
			"AGENTS.md": "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
		},
		"entryCount": 1,
		"uncompressedSize": 500
	}`)

	env, err := ParseManifestEnvelope(valid)
	if err != nil {
		t.Fatalf("ParseManifestEnvelope failed: %v", err)
	}
	if env.Version != "1.0.0" || env.Archive.Size != 1234 || env.EntryCount != 1 {
		t.Fatalf("unexpected envelope fields: %+v", env)
	}

	// Unknown field should fail (disallow unknown fields)
	invalidUnknown := []byte(`{
		"version": "1.0.0",
		"unknownField": "bad",
		"archive": {
			"name": "bundle.tar.gz",
			"size": 1234,
			"sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		}
	}`)
	if _, err := ParseManifestEnvelope(invalidUnknown); err == nil {
		t.Fatal("expected ParseManifestEnvelope to fail on unknown field")
	}
}
