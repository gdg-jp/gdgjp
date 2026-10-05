package wiki

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestLockDocumentIdempotentAndExclusive(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}

	first, err := LockDocument(root, "doc-1", "owner-a", "hash-1")
	if err != nil {
		t.Fatal(err)
	}
	if first.Owner != "owner-a" || first.ContentHash != "hash-1" {
		t.Fatalf("first lock = %#v", first)
	}

	again, err := LockDocument(root, "doc-1", "owner-a", "hash-2")
	if err != nil {
		t.Fatal(err)
	}
	if again.ContentHash != "hash-2" {
		t.Fatalf("idempotent re-lock should update hash: %#v", again)
	}

	_, err = LockDocument(root, "doc-1", "owner-b", "")
	if err == nil || !strings.Contains(err.Error(), "locked by owner-a") {
		t.Fatalf("error = %v, want exclusive lock failure", err)
	}

	if err = UnlockDocument(root, "doc-1", "owner-b", false); err == nil || !strings.Contains(err.Error(), "unlock refused") {
		t.Fatalf("error = %v, want unlock refused", err)
	}
	if err = UnlockDocument(root, "doc-1", "owner-a", false); err != nil {
		t.Fatal(err)
	}
	if err = UnlockDocument(root, "doc-1", "owner-a", false); err != nil {
		t.Fatal(err)
	}

	second, err := LockDocument(root, "doc-1", "owner-b", "")
	if err != nil {
		t.Fatal(err)
	}
	if second.Owner != "owner-b" {
		t.Fatalf("second lock = %#v", second)
	}

	src := "locked-src"
	t.Setenv("GDG_WIKI_LOCK_OWNER", "owner-b")
	ids := LockedSourceIDs(root, State{Manifest: &SourcesManifest{Documents: []SourcesManifestEntry{
		{DocumentID: "doc-1", SourceID: &src},
	}}})
	if len(ids) != 1 || ids[0] != "locked-src" {
		t.Fatalf("LockedSourceIDs = %#v", ids)
	}

	if err = UnlockDocument(root, "doc-1", "owner-a", true); err != nil {
		t.Fatal(err)
	}
	locks, err := LoadLocks(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(locks.Locks) != 0 {
		t.Fatalf("locks after force unlock = %#v", locks.Locks)
	}
}

func TestLockedSourceIDsIgnoresOtherOwners(t *testing.T) {
	root := t.TempDir()
	if err := WriteConfig(root, Config{Lang: "ja"}); err != nil {
		t.Fatal(err)
	}
	srcA, srcB := "src-a", "src-b"
	state := State{Manifest: &SourcesManifest{Documents: []SourcesManifestEntry{
		{DocumentID: "doc-a", SourceID: &srcA},
		{DocumentID: "doc-b", SourceID: &srcB},
	}}}
	if _, err := LockDocument(root, "doc-a", "agent-a", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := LockDocument(root, "doc-b", "agent-b", ""); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GDG_WIKI_LOCK_OWNER", "agent-a")
	ids := LockedSourceIDs(root, state)
	if len(ids) != 1 || ids[0] != "src-a" {
		t.Fatalf("ids = %#v, want only agent-a", ids)
	}
}

func TestLockOwnerPrefersEnv(t *testing.T) {
	t.Setenv("GDG_WIKI_LOCK_OWNER", "orchestrator:123")
	if got := LockOwner(); got != "orchestrator:123" {
		t.Fatalf("LockOwner() = %q", got)
	}
}

func TestHelperLockProcess(t *testing.T) {
	if os.Getenv("GO_TEST_LOCK_HELPER") != "1" {
		return
	}
	root := os.Getenv("GO_TEST_LOCK_ROOT")
	if err := AcquireLocksMutexWithTimeout(root, 5*time.Second); err != nil {
		os.Exit(1)
	}
	_, _ = os.Stdout.WriteString("LOCKED\n")
	time.Sleep(30 * time.Second)
	os.Exit(0)
}

func TestAcquireLocksMutexWithTimeout_BasicAndStale(t *testing.T) {
	root := t.TempDir()
	if err := AcquireLocksMutexWithTimeout(root, time.Second); err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	// Second acquire in same process should fail quickly
	err := AcquireLocksMutexWithTimeout(root, 50*time.Millisecond)
	if err == nil {
		t.Fatal("expected second acquire to time out")
	}

	ReleaseLocksMutex(root)

	// Can acquire again
	if err := AcquireLocksMutexWithTimeout(root, time.Second); err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
	ReleaseLocksMutex(root)
}

func TestAcquireLocksMutexWithTimeout_DeadProcessRecovery(t *testing.T) {
	root := t.TempDir()

	// Spawn helper process that acquires the lock
	cmd := exec.Command(os.Args[0], "-test.run=TestHelperLockProcess")
	cmd.Env = append(os.Environ(), "GO_TEST_LOCK_HELPER=1", "GO_TEST_LOCK_ROOT="+root)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}

	// Wait for helper to acquire lock
	buf := make([]byte, 7)
	_, _ = stdout.Read(buf)
	if string(buf) != "LOCKED\n" {
		_ = cmd.Process.Kill()
		t.Fatalf("unexpected helper output: %q", string(buf))
	}

	// Mutex should be held by child process; parent acquisition should time out
	err = AcquireLocksMutexWithTimeout(root, 50*time.Millisecond)
	if err == nil {
		_ = cmd.Process.Kill()
		t.Fatal("expected acquire to fail while child holds lock")
	}

	// Kill child process with SIGKILL (simulates sudden crash / OOM)
	_ = cmd.Process.Kill()
	_ = cmd.Wait()

	// OS must automatically release the file lock; parent must now acquire immediately!
	if err := AcquireLocksMutexWithTimeout(root, 1*time.Second); err != nil {
		t.Fatalf("parent failed acquiring lock after child killed: %v", err)
	}
	ReleaseLocksMutex(root)
}

func TestAcquireLocksMutexWithTimeout_LegacyDirCleanup(t *testing.T) {
	root := t.TempDir()
	mutex := locksMutexPath(root)
	// Create legacy directory at mutex path
	if err := os.MkdirAll(mutex, 0o700); err != nil {
		t.Fatal(err)
	}

	// AcquireLocksMutexWithTimeout should clean up legacy directory and acquire file lock
	if err := AcquireLocksMutexWithTimeout(root, time.Second); err != nil {
		t.Fatalf("failed acquiring lock over legacy directory: %v", err)
	}
	ReleaseLocksMutex(root)
}
