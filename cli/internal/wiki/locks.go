package wiki

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
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

var (
	mutexMu     sync.Mutex
	activeLocks = make(map[string]*os.File)
)

// AcquireLocksMutexWithTimeout uses an OS-managed file lock with a configurable timeout.
func AcquireLocksMutexWithTimeout(root string, timeout time.Duration) error {
	configDir := ConfigDir(root)
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return fmt.Errorf("mkdir config dir: %w", err)
	}
	mutexPath := locksMutexPath(root)

	// Clean up legacy directory if present from older versions
	if fi, err := os.Stat(mutexPath); err == nil && fi.IsDir() {
		_ = os.RemoveAll(mutexPath)
	}

	deadline := time.Now().Add(timeout)
	for {
		// 1. Check in-process lock
		mutexMu.Lock()
		if _, held := activeLocks[root]; held {
			mutexMu.Unlock()
			if time.Now().After(deadline) {
				return fmt.Errorf("lock %s: timed out waiting for mutex", mutexPath)
			}
			time.Sleep(25 * time.Millisecond)
			continue
		}

		// 2. Open lock file
		f, err := os.OpenFile(mutexPath, os.O_CREATE|os.O_RDWR, 0o600)
		if err != nil {
			mutexMu.Unlock()
			return fmt.Errorf("open lock %s: %w", mutexPath, err)
		}

		// 3. Attempt OS-level exclusive non-blocking lock
		if err := osLockFile(f); err != nil {
			mutexMu.Unlock()
			_ = f.Close()
			if time.Now().After(deadline) {
				return fmt.Errorf("lock %s: timed out waiting for mutex", mutexPath)
			}
			time.Sleep(25 * time.Millisecond)
			continue
		}

		// 4. Lock acquired successfully
		_ = f.Truncate(0)
		_, _ = f.Seek(0, 0)
		_, _ = f.WriteString(fmt.Sprintf("%d\n", os.Getpid()))
		activeLocks[root] = f
		mutexMu.Unlock()
		return nil
	}
}

// ReleaseLocksMutex releases the OS-managed lock if held by this process.
func ReleaseLocksMutex(root string) {
	mutexMu.Lock()
	f, ok := activeLocks[root]
	if ok {
		delete(activeLocks, root)
	}
	mutexMu.Unlock()

	if ok && f != nil {
		_ = osUnlockFile(f)
		_ = f.Close()
	}
}

func acquireLocksMutex(root string) error {
	return AcquireLocksMutexWithTimeout(root, 10*time.Second)
}

func releaseLocksMutex(root string) {
	ReleaseLocksMutex(root)
}

// LockedSourceIDs returns source ids for documents locked by LockOwner.
// Parallel ingest must not inherit another agent's locked source.
func LockedSourceIDs(root string, state State) []string {
	if state.Manifest == nil {
		return nil
	}
	locks, err := LoadLocks(root)
	if err != nil {
		return nil
	}
	byDoc := map[string]string{}
	for _, doc := range state.Manifest.Documents {
		if doc.SourceID != nil && *doc.SourceID != "" {
			byDoc[doc.DocumentID] = *doc.SourceID
		}
	}
	seen := map[string]struct{}{}
	var ids []string
	for documentID, entry := range locks.Locks {
		if entry.Owner != LockOwner() {
			continue
		}
		id := byDoc[documentID]
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}
