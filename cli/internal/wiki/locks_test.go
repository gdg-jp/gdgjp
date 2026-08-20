package wiki

import (
	"strings"
	"testing"
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

func TestLockOwnerPrefersEnv(t *testing.T) {
	t.Setenv("GDG_WIKI_LOCK_OWNER", "orchestrator:123")
	if got := LockOwner(); got != "orchestrator:123" {
		t.Fatalf("LockOwner() = %q", got)
	}
}
