package wiki

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const LocksFileName = "ingest-locks.json"

// IngestLockEntry is one exclusive claim on a pending document_id.
type IngestLockEntry struct {
	DocumentID  string `json:"document_id"`
	LockedAt    string `json:"locked_at"`
	Owner       string `json:"owner"`
	ContentHash string `json:"content_hash,omitempty"`
}

// IngestLocksFile is the on-disk lock map under .gdgwiki/.
type IngestLocksFile struct {
	Locks map[string]IngestLockEntry `json:"locks"`
}

func LocksPath(root string) string {
	return filepath.Join(ConfigDir(root), LocksFileName)
}

func locksMutexPath(root string) string {
	return LocksPath(root) + ".mutex"
}

// LockOwner returns a stable lock identity.
// Prefer GDG_WIKI_LOCK_OWNER when set (orchestrators should export a per-run
// value so lock/unlock subprocesses share the same owner). Otherwise use
// hostname:pid.
func LockOwner() string {
	if owner := strings.TrimSpace(os.Getenv("GDG_WIKI_LOCK_OWNER")); owner != "" {
		return owner
	}
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "unknown"
	}
	return fmt.Sprintf("%s:%d", host, os.Getpid())
}

// LockDocument acquires an exclusive lock on documentID.
// Same-owner re-lock is idempotent. Another owner returns a non-nil error.
func LockDocument(root, documentID, owner, contentHash string) (IngestLockEntry, error) {
	if documentID == "" {
		return IngestLockEntry{}, errors.New("document_id is required")
	}
	if owner == "" {
		owner = LockOwner()
	}
	var result IngestLockEntry
	err := withLocksFile(root, func(file *IngestLocksFile) error {
		if existing, ok := file.Locks[documentID]; ok {
			if existing.Owner == owner {
				if contentHash != "" {
					existing.ContentHash = contentHash
					file.Locks[documentID] = existing
				}
				result = existing
				return nil
			}
			return fmt.Errorf("document %s is locked by %s (since %s)", documentID, existing.Owner, existing.LockedAt)
		}
		entry := IngestLockEntry{
			DocumentID:  documentID,
			LockedAt:    time.Now().UTC().Format(time.RFC3339),
			Owner:       owner,
			ContentHash: contentHash,
		}
		file.Locks[documentID] = entry
		result = entry
		return nil
	})
	return result, err
}

// UnlockDocument releases a lock. Missing locks succeed (idempotent).
// Owner must match unless force is true.
func UnlockDocument(root, documentID, owner string, force bool) error {
	if documentID == "" {
		return errors.New("document_id is required")
	}
	if owner == "" {
		owner = LockOwner()
	}
	return withLocksFile(root, func(file *IngestLocksFile) error {
		existing, ok := file.Locks[documentID]
		if !ok {
			return nil
		}
		if !force && existing.Owner != owner {
			return fmt.Errorf("document %s is locked by %s; unlock refused for owner %s", documentID, existing.Owner, owner)
		}
		delete(file.Locks, documentID)
		return nil
	})
}

// LoadLocks returns the current lock map (empty if absent).
func LoadLocks(root string) (IngestLocksFile, error) {
	raw, err := os.ReadFile(LocksPath(root))
	if os.IsNotExist(err) {
		return IngestLocksFile{Locks: map[string]IngestLockEntry{}}, nil
	}
	if err != nil {
		return IngestLocksFile{}, err
	}
	var file IngestLocksFile
	if err = json.Unmarshal(raw, &file); err != nil {
		return IngestLocksFile{}, fmt.Errorf("parse %s: %w", LocksPath(root), err)
	}
	if file.Locks == nil {
		file.Locks = map[string]IngestLockEntry{}
	}
	return file, nil
}

func withLocksFile(root string, mutate func(*IngestLocksFile) error) error {
	if err := os.MkdirAll(ConfigDir(root), 0o755); err != nil {
		return err
	}
	if err := acquireLocksMutex(root); err != nil {
		return err
	}
	defer releaseLocksMutex(root)

	path := LocksPath(root)
	file := IngestLocksFile{Locks: map[string]IngestLockEntry{}}
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(raw) > 0 {
		if err = json.Unmarshal(raw, &file); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		if file.Locks == nil {
			file.Locks = map[string]IngestLockEntry{}
		}
	}
	if err = mutate(&file); err != nil {
		return err
	}
	raw, err = json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	tmp := path + ".tmp"
	if err = os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// acquireLocksMutex uses mkdir as a portable exclusive lock (works on Unix and
// Windows; syscall.Flock is unavailable on Windows).
func acquireLocksMutex(root string) error {
	mutex := locksMutexPath(root)
	deadline := time.Now().Add(10 * time.Second)
	for {
		err := os.Mkdir(mutex, 0o700)
		if err == nil {
			return nil
		}
		if !os.IsExist(err) {
			return fmt.Errorf("lock %s: %w", mutex, err)
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("lock %s: timed out waiting for mutex", mutex)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func releaseLocksMutex(root string) {
	_ = os.Remove(locksMutexPath(root))
}
