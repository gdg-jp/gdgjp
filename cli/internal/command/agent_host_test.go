package command

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEmitLayoutPrefixUsesEmbeddedSpec(t *testing.T) {
	prefix := t.TempDir()
	root := NewRoot()
	root.SetArgs([]string{"agent-host", "emit-layout", "--prefix", prefix})
	root.SilenceUsage = true
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	wk := filepath.Join(prefix, "opt/gdg-agent/bin/wk")
	if _, err := os.Stat(wk); err != nil {
		t.Fatalf("embedded-spec emit-layout did not write wk: %v", err)
	}
}
