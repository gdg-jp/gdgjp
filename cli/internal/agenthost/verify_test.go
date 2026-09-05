package agenthost

import (
	"context"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"testing"
	"time"
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
	// gdgagent-run-0 is a real account on hosts where agent-host has actually been applied, so
	// don't assume it's absent here -- point the lookup at a name checked to not resolve instead.
	original := slotZeroUsername
	t.Cleanup(func() { slotZeroUsername = original })

	candidate := fmt.Sprintf("gdg-verify-test-%d-%d", os.Getpid(), time.Now().UnixNano())
	if _, err := user.Lookup(candidate); err == nil {
		candidate = fmt.Sprintf("gdg-verify-test-%d-%d", os.Getpid(), time.Now().UnixNano())
		if _, err := user.Lookup(candidate); err == nil {
			t.Fatalf("test setup invalid: candidate username %q unexpectedly resolved to a real user", candidate)
		}
	}
	slotZeroUsername = candidate

	// VerifyHost must skip and return nil when slotZeroUsername does not exist
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
