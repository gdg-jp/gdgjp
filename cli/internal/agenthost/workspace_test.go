package agenthost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

func createTestSignedBundle(t *testing.T, outDir string, files map[string][]byte, privKey ed25519.PrivateKey) (string, string) {
	t.Helper()
	var entries []struct {
		Name     string
		Content  []byte
		Typeflag byte
		Linkname string
	}

	entriesMap := make(map[string]string)
	for relPath, content := range files {
		entries = append(entries, struct {
			Name     string
			Content  []byte
			Typeflag byte
			Linkname string
		}{
			Name:    relPath,
			Content: content,
		})
		sum := sha256New(content)
		entriesMap[relPath] = hex.EncodeToString(sum)
	}

	rawArchive, archiveSum, uncompSize := createTestArchive(t, entries)
	archiveName := "agent-host-workspace-1.0.0.tar.gz"
	archivePath := filepath.Join(outDir, archiveName)
	if err := os.WriteFile(archivePath, rawArchive, 0o644); err != nil {
		t.Fatal(err)
	}

	envelope := ManifestEnvelope{
		Version: "1.0.0",
		Type:    "workspace",
		Archive: ArchiveInfo{
			Name:   archiveName,
			Size:   int64(len(rawArchive)),
			SHA256: archiveSum,
		},
		Entries:          entriesMap,
		EntryCount:       len(entries),
		UncompressedSize: uncompSize,
	}

	manifestBytes, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(outDir, "agent-host-workspace-1.0.0.manifest.json")
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	sig := ed25519.Sign(privKey, manifestBytes)
	sigPath := manifestPath + ".sig"
	if err := os.WriteFile(sigPath, []byte(hex.EncodeToString(sig)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	return manifestPath, sigPath
}

func setupTestSpecAndPrefix(t *testing.T, prefix string) string {
	t.Helper()
	specJSON := fmt.Sprintf(`{
		"$schema": "./agent-host.schema.json",
		"slotCount": 4,
		"backend": {
			"name": "cursor",
			"model": "composer-2.5"
		},
		"discord": {
			"showThinking": false,
			"streaming": false,
			"completionNotify": "off"
		},
		"pins": {
			"cursorAgent": {
				"version": "2026.08.11-e8db854",
				"sha256": {
					"x86_64": "bfff4bf6f4e9dd30c1d0ef0a70b6077b074015dd2948e4c50685d53afdcfce5a",
					"aarch64": "ea13f92e295f523a99ce8d8f57d6894d21e5d1e2d030ffad718ccd5955ca2eed"
				}
			},
			"xangi": {
				"repo": "https://github.com/Harineko0/xangi.git",
				"ref": "b3db5919a5e33769ef8d7bcef245aa6b76974948"
			},
			"gws": {
				"version": "v0.22.5",
				"sha256": {
					"x86_64": "de78ecdbd2f1a84cca0063a7ecbc440240fc14b6ebccbb17f4646b792a8c5c1f",
					"aarch64": "94490295d9580e1e88574e715a0a162991747d12d62f8c7b8dcc8268b6c1cea0"
				}
			},
			"gdgCli": {
				"version": "0.3.1",
				"assetTemplate": "gdg_{version}_linux_{arch}.zip",
				"sha256": {
					"x86_64": "521302e1837bb5023b2574c03e59db4f9a7e6cb9a28f55fc70b42660768fdc53",
					"aarch64": "87b641f470f74d1ac3c6324500197ceb51f2807e5773723a47a38ca76444030b"
				}
			},
			"node": {
				"major": 22,
				"minMinor": 18
			}
		},
		"paths": {
			"agentRoot": "/opt/gdg-agent",
			"workspace": "/srv/gdg-agent/wiki",
			"runRoot": "/run/gdg-agent"
		}
	}`)
	specPath := filepath.Join(prefix, "agent-host.json")
	if err := os.WriteFile(specPath, []byte(specJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	return specPath
}

func TestSyncWorkspace_SignedBundleAndSynthesis(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	if err := os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	bundleDir := filepath.Join(prefix, "bundle")
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatal(err)
	}

	agentsMDContent := []byte("# Agent Guidelines\nBe helpful.")
	skillContent := []byte("---\nname: my-skill\ndescription: test skill\n---\nSkill content")

	bundleFiles := map[string][]byte{
		"AGENTS.md":                        agentsMDContent,
		".agents/skills/my-skill/SKILL.md": skillContent,
	}

	manifestPath, _ := createTestSignedBundle(t, bundleDir, bundleFiles, privKey)

	// Execute SyncWorkspace
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err != nil {
		t.Fatalf("SyncWorkspace failed: %v", err)
	}

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")

	// Verify .cursor/rules/local.mdc was synthesized with required frontmatter
	localMdcPath := filepath.Join(wikiRoot, ".cursor/rules/local.mdc")
	mdcBytes, err := os.ReadFile(localMdcPath)
	if err != nil {
		t.Fatalf("reading local.mdc failed: %v", err)
	}
	expectedMdc := fmt.Sprintf("---\nalwaysApply: true\n---\n\n%s", string(agentsMDContent))
	if string(mdcBytes) != expectedMdc {
		t.Fatalf("local.mdc content mismatch:\ngot:\n%s\nwant:\n%s", string(mdcBytes), expectedMdc)
	}

	// Verify skill was deployed
	deployedSkillPath := filepath.Join(wikiRoot, ".agents/skills/my-skill/SKILL.md")
	deployedBytes, err := os.ReadFile(deployedSkillPath)
	if err != nil {
		t.Fatalf("reading deployed skill failed: %v", err)
	}
	if string(deployedBytes) != string(skillContent) {
		t.Fatalf("skill content mismatch")
	}

	// Verify AGENTS.md was not directly written to wiki root (it should only be synthesized as local.mdc)
	if _, err := os.Stat(filepath.Join(wikiRoot, "AGENTS.md")); err == nil {
		t.Fatal("AGENTS.md should not be written to wiki root directly")
	}
}

func TestSyncWorkspace_WikiMutexYield(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	if err := os.MkdirAll(wikiRoot, 0o755); err != nil {
		t.Fatal(err)
	}

	// Hold mutex manually using the same lock mechanism
	if err := wiki.AcquireLocksMutexWithTimeout(wikiRoot, 1*time.Second); err != nil {
		t.Fatal(err)
	}
	defer wiki.ReleaseLocksMutex(wikiRoot)

	// SyncWorkspace should wait with short timeout and yield cleanly (return nil without error)
	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:   "dummy",
		SpecPath: specPath,
		Prefix:   prefix,
		Timeout:  100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("expected clean yield when mutex held, got error: %v", err)
	}
}

func TestSyncWorkspace_SignatureRejection(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	bundleDir := filepath.Join(prefix, "bundle")
	_ = os.MkdirAll(bundleDir, 0o755)

	manifestPath, sigPath := createTestSignedBundle(t, bundleDir, map[string][]byte{
		"AGENTS.md": []byte("foo"),
	}, privKey)

	// Tamper signature
	_ = os.WriteFile(sigPath, []byte(strings.Repeat("0", 128)), 0o644)

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err == nil {
		t.Fatal("expected corrupted signature to be rejected")
	}
	if !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// Missing signature (detached .sig removed)
	_ = os.Remove(sigPath)
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err == nil {
		t.Fatal("expected missing signature to be rejected")
	}
}

func TestSyncWorkspace_LocalModificationsAndForce(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	bundleDir := filepath.Join(prefix, "bundle")
	_ = os.MkdirAll(bundleDir, 0o755)

	manifestPath, _ := createTestSignedBundle(t, bundleDir, map[string][]byte{
		".agents/skills/s1/SKILL.md": []byte("initial version"),
	}, privKey)

	// Apply initial version
	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err != nil {
		t.Fatalf("initial sync failed: %v", err)
	}

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	skillPath := filepath.Join(wikiRoot, ".agents/skills/s1/SKILL.md")

	// Manually edit the skill in the worktree
	if err := os.WriteFile(skillPath, []byte("local modified version"), 0o660); err != nil {
		t.Fatal(err)
	}

	// Create new bundle with version 2
	bundleDir2 := filepath.Join(prefix, "bundle2")
	_ = os.MkdirAll(bundleDir2, 0o755)
	manifestPath2, _ := createTestSignedBundle(t, bundleDir2, map[string][]byte{
		".agents/skills/s1/SKILL.md": []byte("upstream v2"),
	}, privKey)

	// Sync without --force must fail
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath2,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
		Force:      false,
	})
	if err == nil {
		t.Fatal("expected sync without --force to fail on local modification")
	}
	if !strings.Contains(err.Error(), "local modification detected") {
		t.Fatalf("unexpected error: %v", err)
	}

	// Worktree content must NOT have been overwritten
	data, _ := os.ReadFile(skillPath)
	if string(data) != "local modified version" {
		t.Fatal("local modification was unexpectedly destroyed without --force")
	}

	// Sync with --force must succeed and overwrite
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath2,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
		Force:      true,
	})
	if err != nil {
		t.Fatalf("sync with --force failed: %v", err)
	}
	data, _ = os.ReadFile(skillPath)
	if string(data) != "upstream v2" {
		t.Fatalf("expected worktree to be updated to upstream v2 with --force, got: %s", string(data))
	}
}

func TestSyncWorkspace_CrashRecoveryModeB(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	skillPath := filepath.Join(wikiRoot, ".agents/skills/s1/SKILL.md")
	_ = os.MkdirAll(filepath.Dir(skillPath), 0o755)
	_ = os.WriteFile(skillPath, []byte("corrupted partial content"), 0o644)

	varLib := filepath.Join(prefix, "var/lib/agent-host")
	backupDir := filepath.Join(varLib, "workspace-backup", "aborted-txn-1")
	journalDir := filepath.Join(varLib, "workspace-journal")
	_ = os.MkdirAll(filepath.Join(backupDir, ".agents/skills/s1"), 0o755)
	_ = os.MkdirAll(journalDir, 0o755)

	// Backup contains the original pristine file
	pristineContent := []byte("pristine original content before crash")
	_ = os.WriteFile(filepath.Join(backupDir, ".agents/skills/s1/SKILL.md"), pristineContent, 0o600)

	// Write in-progress journal
	journal := WorkspaceJournal{
		TxnID:      "aborted-txn-1",
		Status:     "in-progress",
		BackupDir:  backupDir,
		TargetRoot: wikiRoot,
		Files: map[string]JournalFileState{
			".agents/skills/s1/SKILL.md": {
				RelPath: ".agents/skills/s1/SKILL.md",
				Existed: true,
			},
		},
		CreatedAt: time.Now(),
	}
	jBytes, _ := json.Marshal(journal)
	_ = os.WriteFile(filepath.Join(journalDir, "aborted-txn-1.json"), jBytes, 0o600)

	// Check that CheckIncompleteTransactions detects it
	hasIncomplete, txns, err := CheckIncompleteTransactions(journalDir)
	if err != nil || !hasIncomplete || len(txns) != 1 || !strings.HasPrefix(txns[0], "aborted-txn-1") {
		t.Fatalf("expected CheckIncompleteTransactions to find aborted-txn-1, got %v (txns: %v)", hasIncomplete, txns)
	}

	// Now run SyncWorkspace with an unreachable/broken source.
	// Startup recovery must run FIRST and restore the worktree even though source acquisition will fail.
	_ = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:   filepath.Join(prefix, "nonexistent-source"),
		SpecPath: specPath,
		Prefix:   prefix,
	})

	// Worktree MUST now be restored to pristine content!
	restored, err := os.ReadFile(skillPath)
	if err != nil || string(restored) != string(pristineContent) {
		t.Fatalf("expected worktree to be restored to pristine content, got: %s (err: %v)", restored, err)
	}

	// Journal should now be cleaned up
	hasIncompleteAfter, _, _ := CheckIncompleteTransactions(journalDir)
	if hasIncompleteAfter {
		t.Fatal("expected journal to be cleaned up after recovery")
	}
}

func TestSyncWorkspace_CrashRecoveryModeB_CommittedRepairsLastApplied(t *testing.T) {
	prefix := t.TempDir()
	_ = setupTestSpecAndPrefix(t, prefix)

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	varLib := filepath.Join(prefix, "var/lib/agent-host")
	backupDir := filepath.Join(varLib, "workspace-backup", "committed-txn-1")
	journalDir := filepath.Join(varLib, "workspace-journal")
	lastAppliedPath := filepath.Join(varLib, "workspace-last-applied.json")
	_ = os.MkdirAll(backupDir, 0o755)
	_ = os.MkdirAll(journalDir, 0o755)

	now := time.Now().UTC()
	nextManifest := LastAppliedManifest{
		Version:   "2.0.0",
		UpdatedAt: now,
		Entries: map[string]string{
			"AGENTS.md": "testhash123",
		},
	}

	// Journal was marked committed before process crashed
	journal := WorkspaceJournal{
		TxnID:           "committed-txn-1",
		Status:          "committed",
		BackupDir:       backupDir,
		TargetRoot:      wikiRoot,
		LastAppliedPath: lastAppliedPath,
		NextManifest:    &nextManifest,
		CreatedAt:       now,
		CommittedAt:     &now,
	}
	jBytes, _ := json.Marshal(journal)
	_ = os.WriteFile(filepath.Join(journalDir, "committed-txn-1.json"), jBytes, 0o600)

	// Ensure last-applied is initially missing
	_ = os.Remove(lastAppliedPath)

	// Run recovery
	if err := RecoverIncompleteTransactions(journalDir, wikiRoot); err != nil {
		t.Fatalf("RecoverIncompleteTransactions failed: %v", err)
	}

	// Verify last-applied.json was created and has nextManifest content
	laData, err := os.ReadFile(lastAppliedPath)
	if err != nil {
		t.Fatalf("expected last-applied.json to be created: %v", err)
	}
	var recoveredApplied LastAppliedManifest
	if err := json.Unmarshal(laData, &recoveredApplied); err != nil {
		t.Fatalf("parse recovered last-applied: %v", err)
	}
	if recoveredApplied.Version != "2.0.0" || recoveredApplied.Entries["AGENTS.md"] != "testhash123" {
		t.Fatalf("unexpected recovered last-applied content: %#v", recoveredApplied)
	}

	// Backup and journal should be removed
	if _, err := os.Stat(backupDir); !os.IsNotExist(err) {
		t.Errorf("expected backup dir to be removed, got: %v", err)
	}
	if _, err := os.Stat(filepath.Join(journalDir, "committed-txn-1.json")); !os.IsNotExist(err) {
		t.Errorf("expected committed journal to be removed, got: %v", err)
	}
}

func TestSyncWorkspace_Tier1BoundaryEnforced(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	// Create signed bundle containing forbidden config
	evilBundleDir := filepath.Join(prefix, "evil-bundle")
	_ = os.MkdirAll(evilBundleDir, 0o755)
	manifestPath, _ := createTestSignedBundle(t, evilBundleDir, map[string][]byte{
		"agent-host.json": []byte("{}"),
	}, privKey)

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err == nil {
		t.Fatal("expected Tier 1 boundary violation for agent-host.json in workspace bundle")
	}
	if !strings.Contains(err.Error(), "Tier 1 boundary violation") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCheckIncompleteTransactions(t *testing.T) {
	tmpDir := t.TempDir()
	journalDir := filepath.Join(tmpDir, "workspace-journal")
	_ = os.MkdirAll(journalDir, 0o755)

	has, txns, err := CheckIncompleteTransactions(journalDir)
	if err != nil || has || len(txns) != 0 {
		t.Fatalf("expected no incomplete txns, got: %v %v %v", has, txns, err)
	}

	// Committed uncleaned journal should be flagged as requiring cleanup
	committed := WorkspaceJournal{TxnID: "t1", Status: "committed"}
	cBytes, _ := json.Marshal(committed)
	_ = os.WriteFile(filepath.Join(journalDir, "t1.json"), cBytes, 0o644)

	has, txns, err = CheckIncompleteTransactions(journalDir)
	if err != nil || !has || len(txns) != 1 || !strings.Contains(txns[0], "t1 (committed)") {
		t.Fatalf("expected committed uncleaned txn detected, got: %v %v (err: %v)", has, txns, err)
	}

	// In-progress journal
	inProg := WorkspaceJournal{TxnID: "t2", Status: "in-progress"}
	iBytes, _ := json.Marshal(inProg)
	_ = os.WriteFile(filepath.Join(journalDir, "t2.json"), iBytes, 0o644)

	has, txns, err = CheckIncompleteTransactions(journalDir)
	if err != nil || !has || len(txns) != 2 {
		t.Fatalf("expected 2 incomplete txns detected, got: %v %v", has, txns)
	}

	// Corrupted journal file should return error
	_ = os.WriteFile(filepath.Join(journalDir, "corrupted.json"), []byte("{malformed json"), 0o644)
	has, txns, err = CheckIncompleteTransactions(journalDir)
	if err == nil || !has {
		t.Fatalf("expected error on corrupted journal file, got: has=%v, txns=%v, err=%v", has, txns, err)
	}
}

func TestSyncWorkspace_PlainDirectoryRejected(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	plainDir := filepath.Join(prefix, "plain-dir")
	_ = os.MkdirAll(plainDir, 0o755)
	_ = os.WriteFile(filepath.Join(plainDir, "AGENTS.md"), []byte("unsigned"), 0o644)

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:   plainDir,
		SpecPath: specPath,
		Prefix:   prefix,
	})
	if err == nil {
		t.Fatal("expected unsigned plain directory to be rejected")
	}
	if !strings.Contains(err.Error(), "unsigned plain directories are not permitted") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestSyncWorkspace_DeletionRequiresForceWhenLocallyModified(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	bundleDir1 := filepath.Join(prefix, "bundle1")
	_ = os.MkdirAll(bundleDir1, 0o755)
	manifest1, _ := createTestSignedBundle(t, bundleDir1, map[string][]byte{
		".agents/skills/keep/SKILL.md":   []byte("keep original"),
		".agents/skills/delete/SKILL.md": []byte("delete original"),
	}, privKey)

	// Initial apply
	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifest1,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err != nil {
		t.Fatalf("initial sync failed: %v", err)
	}

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	deleteTarget := filepath.Join(wikiRoot, ".agents/skills/delete/SKILL.md")

	// Locally edit delete target file
	localModified := []byte("delete target modified locally by human operator")
	if err := os.WriteFile(deleteTarget, localModified, 0o660); err != nil {
		t.Fatal(err)
	}

	// Upstream v2 removes delete/SKILL.md and only keeps keep/SKILL.md
	bundleDir2 := filepath.Join(prefix, "bundle2")
	_ = os.MkdirAll(bundleDir2, 0o755)
	manifest2, _ := createTestSignedBundle(t, bundleDir2, map[string][]byte{
		".agents/skills/keep/SKILL.md": []byte("keep original"),
	}, privKey)

	// Sync without --force must fail because deleted file was locally modified!
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifest2,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
		Force:      false,
	})
	if err == nil {
		t.Fatal("expected deletion of locally modified file to fail without --force")
	}
	if !strings.Contains(err.Error(), "local modification detected in file scheduled for deletion") {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify file is still intact
	got, _ := os.ReadFile(deleteTarget)
	if string(got) != string(localModified) {
		t.Fatal("locally modified file was prematurely deleted without --force")
	}

	// Sync with --force must succeed and delete the file
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifest2,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
		Force:      true,
	})
	if err != nil {
		t.Fatalf("sync with --force failed: %v", err)
	}
	if _, err := os.Stat(deleteTarget); !os.IsNotExist(err) {
		t.Fatal("expected file to be deleted when --force was specified")
	}
}

func TestSyncWorkspace_FatalRecoveryOnMissingBackup(t *testing.T) {
	prefix := t.TempDir()
	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	skillPath := filepath.Join(wikiRoot, ".agents/skills/s1/SKILL.md")
	_ = os.MkdirAll(filepath.Dir(skillPath), 0o755)
	_ = os.WriteFile(skillPath, []byte("live content"), 0o644)

	varLib := filepath.Join(prefix, "var/lib/agent-host")
	journalDir := filepath.Join(varLib, "workspace-journal")
	_ = os.MkdirAll(journalDir, 0o755)

	// Journal claims Existed: true, but backupDir has no backup file!
	journal := WorkspaceJournal{
		TxnID:      "missing-backup-txn",
		Status:     "in-progress",
		BackupDir:  filepath.Join(varLib, "workspace-backup", "missing-backup-txn"),
		TargetRoot: wikiRoot,
		Files: map[string]JournalFileState{
			".agents/skills/s1/SKILL.md": {
				RelPath: ".agents/skills/s1/SKILL.md",
				Existed: true,
			},
		},
		CreatedAt: time.Now(),
	}
	jBytes, _ := json.Marshal(journal)
	_ = os.WriteFile(filepath.Join(journalDir, "missing-backup-txn.json"), jBytes, 0o600)

	err := RecoverIncompleteTransactions(journalDir, wikiRoot)
	if err == nil {
		t.Fatal("expected fatal recovery error when backup file is missing for Existed: true")
	}
	if !strings.Contains(err.Error(), "missing backup file") {
		t.Fatalf("unexpected recovery error: %v", err)
	}

	// Live file MUST NOT have been deleted!
	content, err := os.ReadFile(skillPath)
	if err != nil || string(content) != "live content" {
		t.Fatalf("live file was deleted during failed recovery: err=%v, content=%s", err, string(content))
	}
}

func TestSyncWorkspace_HTTPFetching(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	bundleDir := filepath.Join(prefix, "server-bundle")
	_ = os.MkdirAll(bundleDir, 0o755)
	manifestPath, sigPath := createTestSignedBundle(t, bundleDir, map[string][]byte{
		".agents/skills/remote/SKILL.md": []byte("fetched from remote HTTP server"),
	}, privKey)

	// Start httptest server serving bundleDir
	ts := httptest.NewServer(http.FileServer(http.Dir(bundleDir)))
	defer ts.Close()

	remoteManifestURL := ts.URL + "/" + filepath.Base(manifestPath)

	// Sync from HTTP URL
	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     remoteManifestURL,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err != nil {
		t.Fatalf("HTTP workspace sync failed: %v", err)
	}

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	skillPath := filepath.Join(wikiRoot, ".agents/skills/remote/SKILL.md")
	data, err := os.ReadFile(skillPath)
	if err != nil || string(data) != "fetched from remote HTTP server" {
		t.Fatalf("expected remote skill content, got: %s (err: %v)", string(data), err)
	}

	// Test corrupted remote signature fails verification
	_ = os.WriteFile(sigPath, []byte(strings.Repeat("0", 128)+"\n"), 0o644)
	err = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     remoteManifestURL,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err == nil {
		t.Fatal("expected corrupted remote signature to fail verification")
	}
}

// TestHelperSyncProcess is invoked as a subprocess to test real SIGKILL mid-transaction.
func TestHelperSyncProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	specPath := os.Getenv("TEST_SPEC_PATH")
	prefix := os.Getenv("TEST_PREFIX")
	pubKeyPath := os.Getenv("TEST_PUBKEY_PATH")
	manifestPath := os.Getenv("TEST_MANIFEST_PATH")

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
		OnApplying: func(relPath string) {
			// Signal to parent that we are mid-transaction applying files
			_, _ = os.Stdout.WriteString("READY_FOR_KILL\n")
			_ = os.Stdout.Sync()
			time.Sleep(10 * time.Second)
		},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "helper process error: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

func TestWorkspaceSync_RealSIGKILLInterruptionAndRecovery(t *testing.T) {
	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	skillPath := filepath.Join(wikiRoot, ".agents/skills/s1/SKILL.md")
	_ = os.MkdirAll(filepath.Dir(skillPath), 0o755)

	// Step 1: Apply initial bundle v1
	initialContent := []byte("initial version 1 before SIGKILL")
	bundleDir1 := filepath.Join(prefix, "bundle-v1")
	_ = os.MkdirAll(bundleDir1, 0o755)
	manifestPath1, _ := createTestSignedBundle(t, bundleDir1, map[string][]byte{
		".agents/skills/s1/SKILL.md": initialContent,
	}, privKey)

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath1,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err != nil {
		t.Fatalf("failed initial sync: %v", err)
	}

	// Step 2: Create bundle v2 for upgrade
	bundleDir2 := filepath.Join(prefix, "bundle-v2")
	_ = os.MkdirAll(bundleDir2, 0o755)
	manifestPath2, _ := createTestSignedBundle(t, bundleDir2, map[string][]byte{
		".agents/skills/s1/SKILL.md": []byte("interrupted version 2 update"),
	}, privKey)

	// Launch child process that will sleep during file application
	cmd := exec.Command(os.Args[0], "-test.run=^TestHelperSyncProcess$", "--")
	cmd.Env = append(os.Environ(),
		"GO_WANT_HELPER_PROCESS=1",
		"TEST_SPEC_PATH="+specPath,
		"TEST_PREFIX="+prefix,
		"TEST_PUBKEY_PATH="+pubKeyPath,
		"TEST_MANIFEST_PATH="+manifestPath2,
	)
	cmd.Stderr = os.Stderr

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatalf("failed starting helper process: %v", err)
	}

	// Wait for READY_FOR_KILL signal from child process
	buf := make([]byte, 128)
	n, err := stdoutPipe.Read(buf)
	if err != nil || !strings.Contains(string(buf[:n]), "READY_FOR_KILL") {
		_ = cmd.Process.Kill()
		t.Fatalf("expected READY_FOR_KILL from child, got: %s (err: %v)", string(buf[:n]), err)
	}

	// Child is now suspended in OnApplying (journal written, backup taken). Send SIGKILL!
	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("failed sending SIGKILL to process: %v", err)
	}
	_ = cmd.Wait()

	// Verify that an in-progress transaction was left in the journal directory
	journalDir := filepath.Join(prefix, "var/lib/agent-host", "workspace-journal")
	hasIncomplete, txns, err := CheckIncompleteTransactions(journalDir)
	if err != nil || !hasIncomplete || len(txns) != 1 {
		t.Fatalf("expected in-progress transaction after SIGKILL, got: %v (txns: %v, err: %v)", hasIncomplete, txns, err)
	}

	// Now run SyncWorkspace with an invalid source (e.g. nonexistent).
	// Startup recovery must execute FIRST and completely restore the worktree to pre-sync state!
	_ = SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     filepath.Join(prefix, "unreachable-source"),
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})

	// Verify live worktree was rolled back to initialContent
	current, err := os.ReadFile(skillPath)
	if err != nil || string(current) != string(initialContent) {
		t.Fatalf("worktree was not restored to pre-sync state after SIGKILL: %s (err: %v)", string(current), err)
	}

	// Verify journal was cleanly removed after recovery
	hasIncompleteAfter, _, _ := CheckIncompleteTransactions(journalDir)
	if hasIncompleteAfter {
		t.Fatal("expected journal to be deleted after successful recovery")
	}
}

func TestSyncWorkspace_DeletionFailureAborts(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping permission-based test when running as root")
	}

	prefix := t.TempDir()
	specPath := setupTestSpecAndPrefix(t, prefix)

	pubKey, privKey, _ := ed25519.GenerateKey(rand.Reader)
	pubKeyPath := filepath.Join(prefix, "release-key.pub")
	_ = os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)), 0o644)

	wikiRoot := filepath.Join(prefix, "srv/gdg-agent/wiki")
	subDir := filepath.Join(wikiRoot, ".agents/skills/s1")
	fileToDelete := filepath.Join(subDir, "old.txt")
	_ = os.MkdirAll(subDir, 0o755)
	_ = os.WriteFile(fileToDelete, []byte("to be deleted"), 0o644)

	// Set initial last-applied
	varLib := filepath.Join(prefix, "var/lib/agent-host")
	_ = os.MkdirAll(varLib, 0o755)
	initialHash := hashBytes([]byte("to be deleted"))
	initialApplied := LastAppliedManifest{
		Version:   "1.0.0",
		UpdatedAt: time.Now().UTC(),
		Entries: map[string]string{
			".agents/skills/s1/old.txt": initialHash,
		},
	}
	laRaw, _ := json.Marshal(initialApplied)
	_ = os.WriteFile(filepath.Join(varLib, "workspace-last-applied.json"), laRaw, 0o644)

	// New bundle does NOT include .agents/skills/s1/old.txt, so it should be deleted.
	// But it includes AGENTS.md.
	bundleDir := filepath.Join(prefix, "bundle")
	_ = os.MkdirAll(bundleDir, 0o755)
	manifestPath, _ := createTestSignedBundle(t, bundleDir, map[string][]byte{
		"AGENTS.md": []byte("# Agents"),
	}, privKey)

	// Make subDir read-only so os.Remove(fileToDelete) will fail with permission denied
	if err := os.Chmod(subDir, 0o555); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = os.Chmod(subDir, 0o755)
	}()

	err := SyncWorkspace(context.Background(), SyncWorkspaceOptions{
		Source:     manifestPath,
		SpecPath:   specPath,
		Prefix:     prefix,
		PubKeyPath: pubKeyPath,
	})
	if err == nil {
		t.Fatal("expected SyncWorkspace to fail when deletion fails")
	}
	if !strings.Contains(err.Error(), "delete ") {
		t.Fatalf("expected deletion error, got: %v", err)
	}
}
