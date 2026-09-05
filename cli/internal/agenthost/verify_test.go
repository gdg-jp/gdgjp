package agenthost

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyHostPrefix(t *testing.T) {
	tmpDir := t.TempDir()

	err := VerifyHost(context.Background(), VerifyOptions{
		Prefix: tmpDir,
	})
	if err != nil {
		t.Fatalf("expected nil in prefix mode, got: %v", err)
	}
}

func TestVerifyHostNonExistentUser(t *testing.T) {
	// On machines where gdgagent-run-0 does not exist, VerifyHost must skip and return nil
	err := VerifyHost(context.Background(), VerifyOptions{})
	if err != nil {
		t.Fatalf("expected nil when OS user does not exist, got: %v", err)
	}
}

func TestVerifyHost_IncompleteJournalFails(t *testing.T) {
	tmpDir := t.TempDir()
	journalDir := filepath.Join(tmpDir, "var/lib/agent-host/workspace-journal")
	if err := os.MkdirAll(journalDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Write in-progress journal
	_ = os.WriteFile(filepath.Join(journalDir, "t1.json"), []byte(`{"txnId":"t1","status":"in-progress"}`), 0o644)

	err := VerifyHost(context.Background(), VerifyOptions{
		Prefix: tmpDir,
	})
	if err == nil {
		t.Fatal("expected VerifyHost to fail when incomplete transaction journal remains")
	}
}

func TestVerifyHost_CorruptedJournalFails(t *testing.T) {
	tmpDir := t.TempDir()
	journalDir := filepath.Join(tmpDir, "var/lib/agent-host/workspace-journal")
	if err := os.MkdirAll(journalDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Write corrupted journal
	_ = os.WriteFile(filepath.Join(journalDir, "corrupted.json"), []byte(`{malformed json`), 0o644)

	err := VerifyHost(context.Background(), VerifyOptions{
		Prefix: tmpDir,
	})
	if err == nil {
		t.Fatal("expected VerifyHost to fail when corrupted journal exists")
	}
}
