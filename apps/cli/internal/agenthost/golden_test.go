package agenthost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
)

type goldenEntry struct {
	Path   string `json:"path"`
	Type   string `json:"type"`
	Mode   string `json:"mode"`
	SHA256 string `json:"sha256,omitempty"`
}

func TestEmitLayoutMatchesGoldenTree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	if err := EmitLayout(EmitOptions{Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}
	got, err := snapshotLayout(prefix)
	if err != nil {
		t.Fatal(err)
	}
	goldenPath := filepath.Join("testdata", "golden", "tree.json")
	if os.Getenv("UPDATE_GOLDEN") == "1" {
		raw, marshalErr := json.MarshalIndent(got, "", "  ")
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if writeErr := os.WriteFile(goldenPath, append(raw, '\n'), 0o644); writeErr != nil {
			t.Fatal(writeErr)
		}
		return
	}
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var want []goldenEntry
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	gotJSON, _ := json.MarshalIndent(got, "", "  ")
	wantJSON, _ := json.MarshalIndent(want, "", "  ")
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("emit-layout tree drifted from testdata/golden/tree.json (UPDATE_GOLDEN=1 to refresh)\ngot %d entries, want %d\n%s", len(got), len(want), firstGoldenDiff(want, got))
	}
}

func TestRenderLayoutMatchesGoldenTree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	outDir := t.TempDir()
	if err := RenderLayout(defaultSpec(t), "", outDir, 4); err != nil {
		t.Fatal(err)
	}
	got, err := snapshotLayout(outDir)
	if err != nil {
		t.Fatal(err)
	}
	goldenPath := filepath.Join("testdata", "golden", "tree.json")
	raw, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatal(err)
	}
	var want []goldenEntry
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	gotJSON, _ := json.MarshalIndent(got, "", "  ")
	wantJSON, _ := json.MarshalIndent(want, "", "  ")
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("render layout tree drifted from testdata/golden/tree.json\ngot %d entries, want %d\n%s", len(got), len(want), firstGoldenDiff(want, got))
	}
}

func snapshotLayout(prefix string) ([]goldenEntry, error) {
	var entries []goldenEntry
	err := filepath.WalkDir(prefix, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == prefix {
			return nil
		}
		if d.Name() == ".DS_Store" {
			return nil
		}
		rel, err := filepath.Rel(prefix, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		entry := goldenEntry{
			Path: rel,
			Type: "file",
			Mode: unixModeOctal(info),
		}
		if d.IsDir() {
			entry.Type = "dir"
			entries = append(entries, entry)
			return nil
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		normalized := strings.ReplaceAll(string(body), prefix, "")
		sum := sha256.Sum256([]byte(normalized))
		entry.SHA256 = hex.EncodeToString(sum[:])
		entries = append(entries, entry)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

func unixModeOctal(info os.FileInfo) string {
	unix := uint32(info.Mode().Perm())
	if info.Mode()&os.ModeSticky != 0 {
		unix |= 0o1000
	}
	if info.Mode()&os.ModeSetgid != 0 {
		unix |= 0o2000
	}
	if info.Mode()&os.ModeSetuid != 0 {
		unix |= 0o4000
	}
	return sprintf04o(unix)
}

func firstGoldenDiff(want, got []goldenEntry) string {
	n := len(want)
	if len(got) < n {
		n = len(got)
	}
	for i := 0; i < n; i++ {
		if want[i] != got[i] {
			wb, _ := json.Marshal(want[i])
			gb, _ := json.Marshal(got[i])
			return "first mismatch:\n  want " + string(wb) + "\n  got  " + string(gb)
		}
	}
	if len(want) != len(got) {
		return "entry count differs"
	}
	return "byte-level JSON mismatch"
}
