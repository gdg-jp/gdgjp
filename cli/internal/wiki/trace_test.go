package wiki

import (
	"os"
	"testing"
)

func TestResetAndAppendTrace(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	if err := ResetIngestTrace(root, "doc-1"); err != nil {
		t.Fatal(err)
	}
	trace, err := LoadTrace(root)
	if err != nil {
		t.Fatal(err)
	}
	if trace.QueueHeadID != "doc-1" || trace.RunID == "" || len(trace.Reads) != 0 {
		t.Fatalf("trace = %#v", trace)
	}
	if err = AppendTraceRead(root, "raw/src-1/doc.md"); err != nil {
		t.Fatal(err)
	}
	if err = AppendTraceRead(root, "raw/src-1/doc.md"); err != nil {
		t.Fatal(err)
	}
	if err = AppendTraceWrite(root, "pages/venues/umeda/page.md"); err != nil {
		t.Fatal(err)
	}
	trace, err = LoadTrace(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Reads) != 1 || trace.Reads[0] != "raw/src-1/doc.md" {
		t.Fatalf("reads = %#v", trace.Reads)
	}
	if len(trace.Writes) != 1 {
		t.Fatalf("writes = %#v", trace.Writes)
	}
	if err = ClearIngestTrace(root); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(TracePath(root)); !os.IsNotExist(err) {
		t.Fatalf("trace should be removed, err=%v", err)
	}
}

func TestLoadTraceBrokenJSONStartsEmpty(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(TracePath(root), []byte("{not-json"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadTrace(root)
	if err == nil {
		t.Fatal("expected parse error for broken trace")
	}
	// Append must recover rather than fail the agent read.
	if err = AppendTraceRead(root, "raw/a.md"); err != nil {
		t.Fatal(err)
	}
}
