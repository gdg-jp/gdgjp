package agenthost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

// SyncWorkspaceOptions controls the workspace sync operation.
type SyncWorkspaceOptions struct {
	Source      string
	DryRun      bool
	Diff        bool
	Force       bool
	SpecPath    string
	OverlayPath string
	Prefix      string
	PubKeyPath  string
	Timeout     time.Duration
	OnApplying  func(relPath string)
}

// JournalFileState records the pre-transaction state of an individual file.
type JournalFileState struct {
	RelPath string `json:"relPath"`
	Existed bool   `json:"existed"`
	Mode    uint32 `json:"mode,omitempty"`
}

// WorkspaceJournal records a write-ahead journal entry for Mode B crash recovery.
type WorkspaceJournal struct {
	TxnID           string                      `json:"txnId"`
	Status          string                      `json:"status"` // "in-progress", "committed"
	BackupDir       string                      `json:"backupDir"`
	TargetRoot      string                      `json:"targetRoot"`
	LastAppliedPath string                      `json:"lastAppliedPath,omitempty"`
	NextManifest    *LastAppliedManifest        `json:"nextManifest,omitempty"`
	Files           map[string]JournalFileState `json:"files"`
	CreatedAt       time.Time                   `json:"createdAt"`
	CommittedAt     *time.Time                  `json:"committedAt,omitempty"`
}

// LastAppliedManifest tracks the last successfully applied workspace state.
type LastAppliedManifest struct {
	Version   string            `json:"version"`
	UpdatedAt time.Time         `json:"updatedAt"`
	Entries   map[string]string `json:"entries"` // relPath -> sha256
}

type fileChange struct {
	RelPath string
	Action  string // "create", "modify", "delete"
	OldHash string
	NewHash string
}

// CheckIncompleteTransactions checks if any in-progress, uncommitted, or uncleaned transaction journals linger.
// It returns an error if any journal cannot be read or parsed, and reports any
// remaining transaction requiring recovery (including committed but uncleaned transactions).
func CheckIncompleteTransactions(journalDir string) (bool, []string, error) {
	if _, err := os.Stat(journalDir); os.IsNotExist(err) {
		return false, nil, nil
	}

	entries, err := os.ReadDir(journalDir)
	if err != nil {
		return false, nil, err
	}

	var incomplete []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			path := filepath.Join(journalDir, entry.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				return true, nil, fmt.Errorf("read journal file %s: %w", path, err)
			}
			var j WorkspaceJournal
			if err := json.Unmarshal(data, &j); err != nil {
				return true, nil, fmt.Errorf("parse journal file %s: %w", path, err)
			}
			txnID := j.TxnID
			if txnID == "" {
				txnID = strings.TrimSuffix(entry.Name(), ".json")
			}
			status := j.Status
			if status == "" {
				status = "unknown"
			}
			incomplete = append(incomplete, fmt.Sprintf("%s (%s)", txnID, status))
		}
	}
	return len(incomplete) > 0, incomplete, nil
}

func writeLastAppliedSafely(lastAppliedPath string, manifest LastAppliedManifest) error {
	appliedRaw, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal last-applied: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(lastAppliedPath), 0o755); err != nil {
		return fmt.Errorf("mkdir parent %s: %w", filepath.Dir(lastAppliedPath), err)
	}
	tmpApplied := lastAppliedPath + ".tmp"
	if err := os.WriteFile(tmpApplied, appliedRaw, 0o644); err != nil {
		return fmt.Errorf("write last-applied tmp: %w", err)
	}
	if f, err := os.Open(tmpApplied); err == nil {
		_ = f.Sync()
		_ = f.Close()
	}
	if err := os.Rename(tmpApplied, lastAppliedPath); err != nil {
		_ = os.Remove(tmpApplied)
		return fmt.Errorf("rename last-applied: %w", err)
	}
	return nil
}

// RecoverIncompleteTransactions restores live worktree state from real-byte backups
// for any uncommitted transactions before processing new updates.
func RecoverIncompleteTransactions(journalDir, wikiRoot string) error {
	if _, err := os.Stat(journalDir); os.IsNotExist(err) {
		return nil
	}

	entries, err := os.ReadDir(journalDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		jPath := filepath.Join(journalDir, entry.Name())
		data, err := os.ReadFile(jPath)
		if err != nil {
			return fmt.Errorf("read journal file %s: %w", jPath, err)
		}
		var j WorkspaceJournal
		if err := json.Unmarshal(data, &j); err != nil {
			return fmt.Errorf("parse journal file %s: %w", jPath, err)
		}

		if j.Status == "committed" {
			// Transaction was already committed; ensure last-applied is written if present, then finish cleanup
			fmt.Printf("sync-workspace: finishing cleanup for committed transaction %s\n", j.TxnID)
			if j.NextManifest != nil {
				lPath := j.LastAppliedPath
				if lPath == "" {
					lPath = filepath.Join(filepath.Dir(journalDir), "workspace-last-applied.json")
				}
				if err := writeLastAppliedSafely(lPath, *j.NextManifest); err != nil {
					return fmt.Errorf("recover committed last-applied to %s: %w", lPath, err)
				}
			}
			if err := os.RemoveAll(j.BackupDir); err != nil {
				return fmt.Errorf("cleanup committed backup %s: %w", j.BackupDir, err)
			}
			if err := os.Remove(jPath); err != nil {
				return fmt.Errorf("cleanup committed journal %s: %w", jPath, err)
			}
			continue
		}

		if j.Status != "in-progress" {
			continue
		}

		targetRoot := j.TargetRoot
		if targetRoot == "" {
			targetRoot = wikiRoot
		}

		fmt.Printf("sync-workspace: recovering uncommitted transaction %s from backup %s\n", j.TxnID, j.BackupDir)
		for rel, fState := range j.Files {
			destFile := filepath.Join(targetRoot, filepath.FromSlash(rel))
			backupFile := filepath.Join(j.BackupDir, filepath.FromSlash(rel))

			if fState.Existed {
				bInfo, err := os.Stat(backupFile)
				if err != nil {
					return fmt.Errorf("fatal recovery failure: missing backup file %s for existing file %s: %w", backupFile, rel, err)
				}
				if bInfo.IsDir() {
					return fmt.Errorf("fatal recovery failure: backup %s is a directory", backupFile)
				}
				bData, err := os.ReadFile(backupFile)
				if err != nil {
					return fmt.Errorf("recovery failed reading backup %s: %w", backupFile, err)
				}
				destDir := filepath.Dir(destFile)
				if err := os.MkdirAll(destDir, 0o2770); err != nil {
					return fmt.Errorf("recovery failed creating directory %s: %w", destDir, err)
				}
				tmp := destFile + ".recover.tmp"
				mode := os.FileMode(fState.Mode)
				if mode == 0 {
					mode = bInfo.Mode() & 0o777
				}
				if err := os.WriteFile(tmp, bData, mode); err != nil {
					return fmt.Errorf("recovery failed writing %s: %w", tmp, err)
				}
				if err := os.Rename(tmp, destFile); err != nil {
					_ = os.Remove(tmp)
					return fmt.Errorf("recovery failed replacing %s: %w", destFile, err)
				}
			} else {
				// File was newly added during the failed transaction; remove it
				if err := os.Remove(destFile); err != nil && !os.IsNotExist(err) {
					return fmt.Errorf("recovery failed removing newly created file %s: %w", destFile, err)
				}
			}
		}

		if err := os.RemoveAll(j.BackupDir); err != nil {
			return fmt.Errorf("recovery failed removing backup dir %s: %w", j.BackupDir, err)
		}
		if err := os.Remove(jPath); err != nil {
			return fmt.Errorf("recovery failed removing journal file %s: %w", jPath, err)
		}
		fmt.Printf("sync-workspace: recovered transaction %s successfully\n", j.TxnID)
	}

	return nil
}

// SyncWorkspace executes Tier 1 workspace synchronization.
func SyncWorkspace(ctx context.Context, opts SyncWorkspaceOptions) error {
	spec, err := LoadSpecWithOverlay(opts.SpecPath, opts.OverlayPath)
	if err != nil {
		return fmt.Errorf("load spec: %w", err)
	}

	wikiRoot := spec.Paths.Workspace
	agentRoot := spec.Paths.AgentRoot
	if opts.Prefix != "" {
		wikiRoot = filepath.Join(opts.Prefix, strings.TrimPrefix(wikiRoot, "/"))
		agentRoot = filepath.Join(opts.Prefix, strings.TrimPrefix(agentRoot, "/"))
	}

	varLibDir := "/var/lib/agent-host"
	if opts.Prefix != "" {
		varLibDir = filepath.Join(opts.Prefix, "var/lib/agent-host")
	}

	stagingBase := filepath.Join(varLibDir, "workspace-staging")
	backupBase := filepath.Join(varLibDir, "workspace-backup")
	journalDir := filepath.Join(varLibDir, "workspace-journal")
	lastAppliedPath := filepath.Join(varLibDir, "workspace-last-applied.json")

	if err := os.MkdirAll(stagingBase, 0o700); err != nil {
		return fmt.Errorf("create staging directory %s: %w", stagingBase, err)
	}
	if err := os.MkdirAll(backupBase, 0o700); err != nil {
		return fmt.Errorf("create backup directory %s: %w", backupBase, err)
	}
	if err := os.MkdirAll(journalDir, 0o700); err != nil {
		return fmt.Errorf("create journal directory %s: %w", journalDir, err)
	}

	// 1. Acquire wiki mutex. If busy, yield cleanly (non-error exit) to next timer cycle.
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if err := wiki.AcquireLocksMutexWithTimeout(wikiRoot, timeout); err != nil {
		if strings.Contains(err.Error(), "timed out") {
			fmt.Printf("sync-workspace: wiki mutex is currently held (sleep or ingest active); yielding to next scheduled run\n")
			return nil
		}
		return fmt.Errorf("failed acquiring wiki mutex for %s: %w", wikiRoot, err)
	}
	defer wiki.ReleaseLocksMutex(wikiRoot)

	// 2. CRASH RECOVERY FIRST: Run recovery before fetching or verifying new sources
	if err := RecoverIncompleteTransactions(journalDir, wikiRoot); err != nil {
		return fmt.Errorf("startup recovery failed: %w", err)
	}

	// 3. Resolve Public Key for signature verification
	pubKeyPath := opts.PubKeyPath
	if pubKeyPath == "" {
		pubKeyPath = filepath.Join(agentRoot, "lib", "release-key.pub")
	}

	// 4. Acquire & Verify Source Content
	desiredFiles := make(map[string][]byte)
	bundleVersion := "unknown"

	source := strings.TrimSpace(opts.Source)
	if source == "" && spec.WorkspaceSync != nil {
		source = strings.TrimSpace(spec.WorkspaceSync.Source)
	}

	if source == "" {
		return errors.New("no workspace source specified (pass --source or configure workspaceSync.source in spec)")
	}

	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		// HTTP/HTTPS URL source
		v, files, err := fetchHTTPBundle(ctx, source, pubKeyPath, stagingBase)
		if err != nil {
			return fmt.Errorf("fetch remote bundle: %w", err)
		}
		bundleVersion = v
		desiredFiles = files
	} else {
		// Local file or directory source
		sourceInfo, err := os.Stat(source)
		if err != nil {
			return fmt.Errorf("cannot access source %s: %w", source, err)
		}

		if !sourceInfo.IsDir() && (strings.HasSuffix(source, ".json") || strings.HasSuffix(source, ".tar.gz")) {
			// Specific bundle file specified
			manifestPath := source
			if strings.HasSuffix(source, ".tar.gz") {
				manifestPath = strings.TrimSuffix(source, ".tar.gz") + ".manifest.json"
			}
			v, files, err := loadAndVerifyBundle(manifestPath, pubKeyPath, stagingBase)
			if err != nil {
				return err
			}
			bundleVersion = v
			desiredFiles = files
		} else if sourceInfo.IsDir() {
			// Source directory MUST contain a signed release bundle (*.manifest.json + *.tar.gz + *.sig)
			manifestFile, isBundle := findBundleInDir(source)
			if !isBundle {
				return fmt.Errorf("source directory %s does not contain a signed bundle (*.manifest.json); unsigned plain directories are not permitted", source)
			}
			v, files, err := loadAndVerifyBundle(manifestFile, pubKeyPath, stagingBase)
			if err != nil {
				return err
			}
			bundleVersion = v
			desiredFiles = files
		} else {
			return fmt.Errorf("unsupported source: %s", source)
		}
	}

	// 5. Synthesize .cursor/rules/local.mdc from AGENTS.md
	if agentsRaw, ok := desiredFiles["AGENTS.md"]; ok {
		localMDC := fmt.Sprintf("---\nalwaysApply: true\n---\n\n%s", string(agentsRaw))
		desiredFiles[".cursor/rules/local.mdc"] = []byte(localMDC)
		delete(desiredFiles, "AGENTS.md")
	}

	// 6. Enforce Tier 1 boundary on all desired files
	for relPath := range desiredFiles {
		if !isManagedWorkspacePath(relPath) {
			return fmt.Errorf("Tier 1 boundary violation: unmanaged path in sync target: %s", relPath)
		}
	}

	// 7. Load last-applied state
	var lastApplied LastAppliedManifest
	lastApplied.Entries = make(map[string]string)
	if raw, err := os.ReadFile(lastAppliedPath); err == nil {
		_ = json.Unmarshal(raw, &lastApplied)
		if lastApplied.Entries == nil {
			lastApplied.Entries = make(map[string]string)
		}
	}

	// 8. Detect local modifications in live worktree
	// Check all files in desiredFiles + existing managed files in worktree
	for relPath, desiredData := range desiredFiles {
		targetPath := filepath.Join(wikiRoot, filepath.FromSlash(relPath))
		if curData, err := os.ReadFile(targetPath); err == nil {
			curHash := hashBytes(curData)
			desHash := hashBytes(desiredData)
			lastHash := lastApplied.Entries[relPath]

			if lastHash != "" && curHash != lastHash && curHash != desHash {
				if !opts.Force {
					return fmt.Errorf("local modification detected in %s (current: %s, last-applied: %s); aborting without --force", relPath, curHash, lastHash)
				}
			} else if lastHash == "" && curHash != desHash {
				if !opts.Force {
					return fmt.Errorf("local modification detected in unrecorded file %s; aborting without --force", relPath)
				}
			}
		}
	}

	// 9. Plan Changes
	var changes []fileChange
	desiredKeys := make(map[string]bool)
	for relPath, desiredData := range desiredFiles {
		desiredKeys[relPath] = true
		targetPath := filepath.Join(wikiRoot, filepath.FromSlash(relPath))
		curData, err := os.ReadFile(targetPath)
		desHash := hashBytes(desiredData)
		if err != nil {
			if os.IsNotExist(err) {
				changes = append(changes, fileChange{
					RelPath: relPath,
					Action:  "create",
					NewHash: desHash,
				})
			} else {
				return err
			}
		} else {
			curHash := hashBytes(curData)
			if curHash != desHash {
				changes = append(changes, fileChange{
					RelPath: relPath,
					Action:  "modify",
					OldHash: curHash,
					NewHash: desHash,
				})
			}
		}
	}

	// Detect deletions (files previously applied that are absent from new desiredFiles)
	for relPath, oldHash := range lastApplied.Entries {
		if !desiredKeys[relPath] {
			targetPath := filepath.Join(wikiRoot, filepath.FromSlash(relPath))
			if curData, err := os.ReadFile(targetPath); err == nil {
				curHash := hashBytes(curData)
				if curHash != oldHash {
					if !opts.Force {
						return fmt.Errorf("local modification detected in file scheduled for deletion %s (current %s, recorded %s); aborting without --force", relPath, curHash[:12], oldHash[:12])
					}
				}
				changes = append(changes, fileChange{
					RelPath: relPath,
					Action:  "delete",
					OldHash: oldHash,
				})
			}
		}
	}

	sort.Slice(changes, func(i, j int) bool {
		return changes[i].RelPath < changes[j].RelPath
	})

	// Diff output
	if opts.Diff {
		for _, ch := range changes {
			switch ch.Action {
			case "create":
				fmt.Printf("+ create %s (%s)\n", ch.RelPath, ch.NewHash[:12])
			case "modify":
				fmt.Printf("~ modify %s (%s -> %s)\n", ch.RelPath, ch.OldHash[:12], ch.NewHash[:12])
			case "delete":
				fmt.Printf("- delete %s (%s)\n", ch.RelPath, ch.OldHash[:12])
			}
		}
	}

	if opts.DryRun {
		if len(changes) > 0 {
			return fmt.Errorf("drift detected: %d changes planned", len(changes))
		}
		return nil
	}

	if len(changes) == 0 {
		return nil
	}

	// 10. ATOMIC APPLY (Mode B)
	txnID := fmt.Sprintf("%d-%d", time.Now().UnixNano(), os.Getpid())
	txnBackupDir := filepath.Join(backupBase, txnID)
	if err := os.MkdirAll(txnBackupDir, 0o700); err != nil {
		return fmt.Errorf("create backup dir: %w", err)
	}
	if err := os.MkdirAll(journalDir, 0o755); err != nil {
		return fmt.Errorf("create journal dir: %w", err)
	}

	fileStates := make(map[string]JournalFileState)
	// Step 1: Backup current real bytes and record existence
	for _, ch := range changes {
		targetPath := filepath.Join(wikiRoot, filepath.FromSlash(ch.RelPath))
		info, err := os.Stat(targetPath)
		if err == nil && !info.IsDir() {
			data, err := os.ReadFile(targetPath)
			if err != nil {
				return fmt.Errorf("read file for backup %s: %w", targetPath, err)
			}
			backupPath := filepath.Join(txnBackupDir, filepath.FromSlash(ch.RelPath))
			if err := os.MkdirAll(filepath.Dir(backupPath), 0o700); err != nil {
				return fmt.Errorf("create backup parent dir: %w", err)
			}
			if err := os.WriteFile(backupPath, data, info.Mode()&0o777); err != nil {
				return fmt.Errorf("write backup %s: %w", backupPath, err)
			}
			fileStates[ch.RelPath] = JournalFileState{
				RelPath: ch.RelPath,
				Existed: true,
				Mode:    uint32(info.Mode() & 0o777),
			}
		} else {
			fileStates[ch.RelPath] = JournalFileState{
				RelPath: ch.RelPath,
				Existed: false,
			}
		}
	}

	// Step 2: Write-ahead journal with fsync
	journal := WorkspaceJournal{
		TxnID:      txnID,
		Status:     "in-progress",
		BackupDir:  txnBackupDir,
		TargetRoot: wikiRoot,
		Files:      fileStates,
		CreatedAt:  time.Now().UTC(),
	}
	journalData, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return err
	}
	journalPath := filepath.Join(journalDir, txnID+".json")
	jf, err := os.OpenFile(journalPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create journal file %s: %w", journalPath, err)
	}
	if _, err := jf.Write(journalData); err != nil {
		_ = jf.Close()
		return fmt.Errorf("write journal: %w", err)
	}
	if err := jf.Sync(); err != nil {
		_ = jf.Close()
		return fmt.Errorf("fsync journal: %w", err)
	}
	_ = jf.Close()

	// Sync directory containing journal
	if df, err := os.Open(journalDir); err == nil {
		_ = df.Sync()
		_ = df.Close()
	}

	// Step 3: Apply files to live worktree via temp-write + rename
	for relPath, content := range desiredFiles {
		if opts.OnApplying != nil {
			opts.OnApplying(relPath)
		}
		destPath := filepath.Join(wikiRoot, filepath.FromSlash(relPath))
		destDir := filepath.Dir(destPath)
		if err := os.MkdirAll(destDir, 0o2770); err != nil {
			return fmt.Errorf("mkdir %s: %w", destDir, err)
		}

		tmpFile, err := os.CreateTemp(destDir, ".sync-*")
		if err != nil {
			return fmt.Errorf("create temp file for %s: %w", destPath, err)
		}
		tmpPath := tmpFile.Name()

		if _, err := tmpFile.Write(content); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return fmt.Errorf("write %s: %w", tmpPath, err)
		}
		if err := tmpFile.Sync(); err != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpPath)
			return fmt.Errorf("fsync %s: %w", tmpPath, err)
		}
		_ = tmpFile.Close()

		if err := os.Chmod(tmpPath, 0o660); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("chmod %s: %w", tmpPath, err)
		}

		if err := os.Rename(tmpPath, destPath); err != nil {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("rename %s -> %s: %w", tmpPath, destPath, err)
		}
	}

	// Apply deletions
	for _, ch := range changes {
		if ch.Action == "delete" {
			destPath := filepath.Join(wikiRoot, filepath.FromSlash(ch.RelPath))
			if err := os.Remove(destPath); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("delete %s: %w", destPath, err)
			}
		}
	}

	newApplied := LastAppliedManifest{
		Version:   bundleVersion,
		UpdatedAt: time.Now().UTC(),
		Entries:   make(map[string]string),
	}
	for relPath, content := range desiredFiles {
		newApplied.Entries[relPath] = hashBytes(content)
	}

	// Step 4: Persist committed state to journal before clearing backup
	now := time.Now().UTC()
	journal.Status = "committed"
	journal.CommittedAt = &now
	journal.LastAppliedPath = lastAppliedPath
	journal.NextManifest = &newApplied
	committedData, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal committed journal: %w", err)
	}
	tmpJournal := journalPath + ".commit.tmp"
	if err := os.WriteFile(tmpJournal, committedData, 0o600); err != nil {
		return fmt.Errorf("write committed journal tmp: %w", err)
	}
	if f, err := os.Open(tmpJournal); err == nil {
		_ = f.Sync()
		_ = f.Close()
	}
	if err := os.Rename(tmpJournal, journalPath); err != nil {
		return fmt.Errorf("commit journal rename: %w", err)
	}
	if df, err := os.Open(journalDir); err == nil {
		_ = df.Sync()
		_ = df.Close()
	}

	// Step 5: Write updated last-applied.json
	if err := writeLastAppliedSafely(lastAppliedPath, newApplied); err != nil {
		return fmt.Errorf("write last-applied: %w", err)
	}

	// Step 6: Clean up backup directory and committed journal
	if err := os.RemoveAll(txnBackupDir); err != nil {
		return fmt.Errorf("cleanup backup dir %s: %w", txnBackupDir, err)
	}
	if err := os.Remove(journalPath); err != nil {
		return fmt.Errorf("cleanup journal file %s: %w", journalPath, err)
	}

	return nil
}

func isManagedWorkspacePath(p string) bool {
	p = filepath.ToSlash(p)
	if p == "AGENTS.md" || p == ".cursor/rules/local.mdc" {
		return true
	}
	if strings.HasPrefix(p, ".agents/") || strings.HasPrefix(p, ".claude/") || strings.HasPrefix(p, ".codex/") {
		return true
	}
	return false
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func findBundleInDir(dir string) (string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".manifest.json") {
			return filepath.Join(dir, e.Name()), true
		}
	}
	return "", false
}

func fetchHTTPBundle(ctx context.Context, sourceURL, pubKeyPath, stagingBase string) (string, map[string][]byte, error) {
	manifestURL := sourceURL
	if !strings.HasSuffix(manifestURL, ".json") {
		manifestURL = strings.TrimSuffix(manifestURL, "/") + "/agent-host-workspace.manifest.json"
	}
	sigURL := manifestURL + ".sig"

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	// 1. Download manifest (bounded by 1MB)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return "", nil, fmt.Errorf("create manifest request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("fetch manifest from %s: %w", manifestURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("fetch manifest from %s returned HTTP %d", manifestURL, resp.StatusCode)
	}
	manifestBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return "", nil, fmt.Errorf("read manifest from %s: %w", manifestURL, err)
	}

	// 2. Download signature (bounded by 1MB)
	reqSig, err := http.NewRequestWithContext(ctx, http.MethodGet, sigURL, nil)
	if err != nil {
		return "", nil, fmt.Errorf("create signature request: %w", err)
	}
	respSig, err := client.Do(reqSig)
	if err != nil {
		return "", nil, fmt.Errorf("fetch signature from %s: %w", sigURL, err)
	}
	defer respSig.Body.Close()
	if respSig.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("fetch signature from %s returned HTTP %d", sigURL, respSig.StatusCode)
	}
	sigBytes, err := io.ReadAll(io.LimitReader(respSig.Body, 1024*1024))
	if err != nil {
		return "", nil, fmt.Errorf("read signature from %s: %w", sigURL, err)
	}

	// 3. Verify signature BEFORE downloading the archive
	pubKeyRaw, err := os.ReadFile(pubKeyPath)
	if err != nil {
		return "", nil, fmt.Errorf("read verification public key %s: %w", pubKeyPath, err)
	}
	pubKey, err := ParsePublicKey(pubKeyRaw)
	if err != nil {
		return "", nil, fmt.Errorf("parse public key: %w", err)
	}
	if err := VerifyEnvelopeSignature(manifestBytes, sigBytes, pubKey); err != nil {
		return "", nil, fmt.Errorf("verify downloaded manifest signature: %w", err)
	}

	envelope, err := ParseManifestEnvelope(manifestBytes)
	if err != nil {
		return "", nil, fmt.Errorf("parse manifest envelope: %w", err)
	}

	// 4. Download archive into temporary file in stagingBase
	lastSlash := strings.LastIndex(manifestURL, "/")
	baseURL := manifestURL[:lastSlash]
	archiveURL := baseURL + "/" + envelope.Archive.Name

	reqArchive, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL, nil)
	if err != nil {
		return "", nil, fmt.Errorf("create archive request: %w", err)
	}
	respArchive, err := client.Do(reqArchive)
	if err != nil {
		return "", nil, fmt.Errorf("fetch archive from %s: %w", archiveURL, err)
	}
	defer respArchive.Body.Close()
	if respArchive.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("fetch archive from %s returned HTTP %d", archiveURL, respArchive.StatusCode)
	}

	if err := os.MkdirAll(stagingBase, 0o700); err != nil {
		return "", nil, fmt.Errorf("create staging base: %w", err)
	}
	dlTempFile, err := os.CreateTemp(stagingBase, "download-*.tar.gz")
	if err != nil {
		return "", nil, fmt.Errorf("create temp archive file: %w", err)
	}
	dlPath := dlTempFile.Name()
	defer os.Remove(dlPath)

	hasher := sha256.New()
	writer := io.MultiWriter(dlTempFile, hasher)

	written, err := io.Copy(writer, io.LimitReader(respArchive.Body, envelope.Archive.Size+1024))
	_ = dlTempFile.Close()
	if err != nil {
		return "", nil, fmt.Errorf("download archive body: %w", err)
	}
	if written != envelope.Archive.Size {
		return "", nil, fmt.Errorf("archive size mismatch: got %d bytes, expected %d", written, envelope.Archive.Size)
	}
	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if actualHash != envelope.Archive.SHA256 {
		return "", nil, fmt.Errorf("archive sha256 mismatch: got %s, expected %s", actualHash, envelope.Archive.SHA256)
	}

	// 5. Extract safely to a randomized staging directory
	stagingDir, err := os.MkdirTemp(stagingBase, "staging-*")
	if err != nil {
		return "", nil, fmt.Errorf("create staging temp dir: %w", err)
	}
	defer os.RemoveAll(stagingDir)

	if err := ExtractArchiveSafely(dlPath, stagingDir, envelope, 0, 0); err != nil {
		return "", nil, fmt.Errorf("extract archive safely: %w", err)
	}

	// 6. Read verified files
	files := make(map[string][]byte)
	for relPath := range envelope.Entries {
		extractedPath := filepath.Join(stagingDir, filepath.FromSlash(relPath))
		content, err := os.ReadFile(extractedPath)
		if err != nil {
			return "", nil, fmt.Errorf("read verified file %s: %w", relPath, err)
		}
		files[relPath] = content
	}

	return envelope.Version, files, nil
}

func loadAndVerifyBundle(manifestPath, pubKeyPath, stagingBase string) (string, map[string][]byte, error) {
	sigPath := manifestPath + ".sig"
	if _, err := os.Stat(sigPath); err != nil {
		return "", nil, fmt.Errorf("missing detached signature file: %s", sigPath)
	}

	// Load public key
	pubKeyRaw, err := os.ReadFile(pubKeyPath)
	if err != nil {
		return "", nil, fmt.Errorf("read verification public key at %s: %w", pubKeyPath, err)
	}
	pubKey, err := ParsePublicKey(pubKeyRaw)
	if err != nil {
		return "", nil, fmt.Errorf("parse public key %s: %w", pubKeyPath, err)
	}

	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return "", nil, fmt.Errorf("read manifest %s: %w", manifestPath, err)
	}
	sigBytes, err := os.ReadFile(sigPath)
	if err != nil {
		return "", nil, fmt.Errorf("read signature %s: %w", sigPath, err)
	}

	// Verify Ed25519 signature over manifest bytes
	if err := VerifyEnvelopeSignature(manifestBytes, sigBytes, pubKey); err != nil {
		return "", nil, err
	}

	envelope, err := ParseManifestEnvelope(manifestBytes)
	if err != nil {
		return "", nil, err
	}

	// Locate archive file
	archivePath := filepath.Join(filepath.Dir(manifestPath), envelope.Archive.Name)
	if _, err := os.Stat(archivePath); err != nil {
		return "", nil, fmt.Errorf("archive file %s not found: %w", archivePath, err)
	}

	// Extract defensively to randomized staging dir (never derive directory name from envelope.Version)
	if err := os.MkdirAll(stagingBase, 0o700); err != nil {
		return "", nil, fmt.Errorf("create staging base %s: %w", stagingBase, err)
	}
	stagingDir, err := os.MkdirTemp(stagingBase, "staging-*")
	if err != nil {
		return "", nil, fmt.Errorf("create staging temp dir: %w", err)
	}
	defer os.RemoveAll(stagingDir)

	if err := ExtractArchiveSafely(archivePath, stagingDir, envelope, 0, 0); err != nil {
		return "", nil, fmt.Errorf("extract archive safely: %w", err)
	}

	// Read verified files from staging
	files := make(map[string][]byte)
	for relPath := range envelope.Entries {
		extractedPath := filepath.Join(stagingDir, filepath.FromSlash(relPath))
		content, err := os.ReadFile(extractedPath)
		if err != nil {
			return "", nil, fmt.Errorf("read verified file %s: %w", relPath, err)
		}
		files[relPath] = content
	}

	return envelope.Version, files, nil
}
