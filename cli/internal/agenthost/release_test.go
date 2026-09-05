package agenthost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testReleaseSpecJSON returns a full, schema-valid production spec, with notify threaded through
// so two builds can differ in exactly one observable field (used to simulate a new release).
func testReleaseSpecJSON(t *testing.T, notify string) []byte {
	t.Helper()
	spec := fmt.Sprintf(`{
		"$schema": "./agent-host.schema.json",
		"environment": "production",
		"slotCount": 4,
		"backend": {
			"name": "cursor",
			"model": "composer-2.5",
			"isolation": {
				"slotLauncher": true,
				"osSandbox": "workspace",
				"toolGate": "preToolUse-failClosed"
			}
		},
		"discord": {
			"showThinking": false,
			"streaming": false,
			"completionNotify": %q
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
	}`, notify)
	return []byte(spec)
}

// buildTestReleaseFixture writes a signed Tier 2 release bundle (latest.txt, manifest, detached
// signature, tar.gz archive) into dir, in the exact shape ApplyRelease expects to fetch it (via a
// file:// base URL in tests, matching production's https:// GitHub Releases URL).
func buildTestReleaseFixture(t *testing.T, dir, version string, specJSON []byte, workspaceFiles map[string][]byte, privKey ed25519.PrivateKey) {
	t.Helper()
	buildTestReleaseFixtureFull(t, dir, version, specJSON, nil, workspaceFiles, privKey)
}

// buildTestReleaseFixtureFull is buildTestReleaseFixture plus an optional config/ subtree, for
// tests that need to prove the release's own config/ -- not the embedded default -- is what
// actually gets converged (see withConfigOverrideRoot).
func buildTestReleaseFixtureFull(t *testing.T, dir, version string, specJSON []byte, configFiles, workspaceFiles map[string][]byte, privKey ed25519.PrivateKey) {
	t.Helper()

	files := map[string][]byte{"agent-host.json": specJSON}
	for relPath, content := range configFiles {
		files["config/"+relPath] = content
	}
	for relPath, content := range workspaceFiles {
		files["workspace/"+relPath] = content
	}

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
		}{Name: relPath, Content: content})
		entriesMap[relPath] = hex.EncodeToString(sha256New(content))
	}

	rawArchive, archiveSum, uncompSize := createTestArchive(t, entries)
	archiveName := fmt.Sprintf("agent-host-release-%s.tar.gz", version)
	if err := os.WriteFile(filepath.Join(dir, archiveName), rawArchive, 0o644); err != nil {
		t.Fatal(err)
	}

	envelope := ManifestEnvelope{
		Version: version,
		Type:    "release",
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
	manifestPath := filepath.Join(dir, fmt.Sprintf("agent-host-release-%s.manifest.json", version))
	if err := os.WriteFile(manifestPath, manifestBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	sig := ed25519.Sign(privKey, manifestBytes)
	if err := os.WriteFile(manifestPath+".sig", []byte(hex.EncodeToString(sig)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(dir, "latest.txt"), []byte(version+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// releaseTestHarness bundles the fixed pieces every ApplyRelease test needs: a keypair, a
// prefix-rooted release-key.pub at the path ApplyRelease resolves by default, and a fixture dir.
type releaseTestHarness struct {
	prefix       string
	fixtureDir   string
	releasesRoot string
	pubKeyPath   string
	privKey      ed25519.PrivateKey
	baseURL      string
}

func newReleaseTestHarness(t *testing.T) *releaseTestHarness {
	t.Helper()
	prefix := t.TempDir()
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately NOT at the default {agentRoot}/lib/release-key.pub: that path is itself
	// converger-managed (plan.go deploys the binary's *embedded* release-key.pub there), so a
	// real ApplyRelease call would silently overwrite a key placed there back to the production
	// key on its very first successful apply. Tests pass PubKeyPath explicitly instead, exactly
	// as an operator would via --pubkey for a non-default signing key.
	pubKeyPath := filepath.Join(prefix, "test-release-key.pub")
	if err := os.WriteFile(pubKeyPath, []byte(hex.EncodeToString(pubKey)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fixtureDir := filepath.Join(prefix, "fixture")
	if err := os.MkdirAll(fixtureDir, 0o755); err != nil {
		t.Fatal(err)
	}
	releasesRoot := filepath.Join(prefix, "var/lib/agent-host/releases")
	return &releaseTestHarness{
		prefix:       prefix,
		fixtureDir:   fixtureDir,
		releasesRoot: releasesRoot,
		pubKeyPath:   pubKeyPath,
		privKey:      privKey,
		baseURL:      "file://" + fixtureDir,
	}
}

func (h *releaseTestHarness) applyOpts(dryRun, diff bool) ApplyReleaseOptions {
	return ApplyReleaseOptions{
		Prefix:          h.prefix,
		ReleasesRoot:    h.releasesRoot,
		ManifestBaseURL: h.baseURL,
		PubKeyPath:      h.pubKeyPath,
		DryRun:          dryRun,
		Diff:            diff,
	}
}

func TestApplyRelease_SignatureRejectionBlocksApply(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	// Tamper the detached signature after signing.
	sigPath := filepath.Join(h.fixtureDir, "agent-host-release-1.0.0.manifest.json.sig")
	if err := os.WriteFile(sigPath, []byte(strings.Repeat("0", 128)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := ApplyRelease(context.Background(), h.applyOpts(false, false))
	if err == nil {
		t.Fatal("expected tampered signature to be rejected")
	}
	if !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("unexpected error: %v", err)
	}

	// The archive must never have been fetched/extracted: no release directory should exist.
	if _, statErr := os.Stat(filepath.Join(h.releasesRoot, "1.0.0")); !os.IsNotExist(statErr) {
		t.Fatal("archive must not be extracted when signature verification fails")
	}
	if cur, _ := CurrentReleaseVersion(h.releasesRoot); cur != "" {
		t.Fatalf("current pointer must remain unset, got %q", cur)
	}
}

func TestApplyRelease_ArchiveTamperDetectedDespiteValidSignature(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	// Replace archive bytes after signing (manifest still validly signed, but now describes the
	// OLD archive digest -- the new bytes on disk won't match).
	archivePath := filepath.Join(h.fixtureDir, "agent-host-release-1.0.0.tar.gz")
	if err := os.WriteFile(archivePath, []byte("not a real tarball, swapped after signing"), 0o644); err != nil {
		t.Fatal(err)
	}

	err := ApplyRelease(context.Background(), h.applyOpts(false, false))
	if err == nil {
		t.Fatal("expected archive tamper to be detected")
	}
	// Caught at download time (bounded by the manifest's declared size) before ExtractArchiveSafely
	// even runs its own digest check -- either message is an acceptable "caught the tamper" outcome.
	if !strings.Contains(err.Error(), "digest mismatch") &&
		!strings.Contains(err.Error(), "size mismatch") &&
		!strings.Contains(err.Error(), "does not match manifest-declared size") {
		t.Fatalf("expected a digest/size mismatch error, got: %v", err)
	}
	if cur, _ := CurrentReleaseVersion(h.releasesRoot); cur != "" {
		t.Fatalf("current pointer must remain unset, got %q", cur)
	}
}

func TestApplyRelease_NewVersionAppliesConvergesAndPublishesLiveSpec(t *testing.T) {
	h := newReleaseTestHarness(t)
	agentsMD := []byte("# Guidance\nBe helpful.")
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md":                        agentsMD,
		".agents/skills/my-skill/SKILL.md": []byte("skill body"),
	}, h.privKey)

	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("ApplyRelease failed: %v", err)
	}

	// 1. Standard converger ran: bin wrapper exists.
	if _, err := os.Stat(filepath.Join(h.prefix, "opt/gdg-agent/bin/wk")); err != nil {
		t.Fatalf("expected converger to have applied host resources: %v", err)
	}

	// 2. Tier 1 delegation: workspace content landed via the sync-workspace transaction, not a
	// generic file write -- AGENTS.md synthesized into local.mdc, not written verbatim.
	wikiRoot := filepath.Join(h.prefix, "srv/gdg-agent/wiki")
	mdc, err := os.ReadFile(filepath.Join(wikiRoot, ".cursor/rules/local.mdc"))
	if err != nil {
		t.Fatalf("expected local.mdc to be synthesized: %v", err)
	}
	if !strings.Contains(string(mdc), "Be helpful.") {
		t.Fatalf("local.mdc missing synthesized AGENTS.md content: %s", mdc)
	}
	if _, err := os.Stat(filepath.Join(wikiRoot, "AGENTS.md")); err == nil {
		t.Fatal("AGENTS.md must not be written verbatim to the wiki root")
	}
	if _, err := os.Stat(filepath.Join(wikiRoot, ".agents/skills/my-skill/SKILL.md")); err != nil {
		t.Fatalf("expected skill file to be deployed: %v", err)
	}

	// 3. Live spec published for future invocations.
	liveSpec, err := os.ReadFile(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json"))
	if err != nil {
		t.Fatalf("expected live spec to be published: %v", err)
	}
	if !strings.Contains(string(liveSpec), `"completionNotify": "off"`) {
		t.Fatalf("published live spec content mismatch: %s", liveSpec)
	}

	// 4. Current pointer updated.
	cur, err := CurrentReleaseVersion(h.releasesRoot)
	if err != nil || cur != "1.0.0" {
		t.Fatalf("expected current release 1.0.0, got %q (err %v)", cur, err)
	}
}

func TestApplyRelease_SameVersionAsCurrentIsReportOnlyAndNeverRepairs(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("first apply failed: %v", err)
	}

	// Simulate host-side drift: an operator (or a bug) changed a converged file.
	wk := filepath.Join(h.prefix, "opt/gdg-agent/bin/wk")
	if err := os.WriteFile(wk, []byte("#!/bin/sh\necho tampered\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Re-fetching the SAME version must be report-only: it must neither silently repair the
	// drift (that would mask host tampering as routine convergence) nor touch the durable release
	// store, regardless of --dry-run. It must report non-zero because there IS drift.
	err := ApplyRelease(context.Background(), h.applyOpts(false, false))
	if err == nil {
		t.Fatal("expected drift to be reported as a non-nil error even without --dry-run")
	}
	if !errors.Is(err, ErrDriftDetected) {
		t.Fatalf("expected ErrDriftDetected, got: %v", err)
	}
	stillTampered, err := os.ReadFile(wk)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(stillTampered), "tampered") {
		t.Fatal("a same-version re-fetch must never silently repair host-side drift")
	}
}

func TestApplyRelease_DryRunReportsDriftWithoutApplying(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("initial apply failed: %v", err)
	}
	liveSpecBefore, err := os.ReadFile(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json"))
	if err != nil {
		t.Fatal(err)
	}

	// Publish a new version with different spec content.
	buildTestReleaseFixture(t, h.fixtureDir, "2.0.0", testReleaseSpecJSON(t, "always"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	err = ApplyRelease(context.Background(), h.applyOpts(true, true))
	if err == nil {
		t.Fatal("expected dry-run to report drift for a new, different release")
	}
	if !errors.Is(err, ErrDriftDetected) {
		t.Fatalf("expected ErrDriftDetected, got: %v", err)
	}

	// Nothing should have actually been applied: current pointer and live spec unchanged.
	if cur, _ := CurrentReleaseVersion(h.releasesRoot); cur != "1.0.0" {
		t.Fatalf("dry-run must not move the current pointer, got %q", cur)
	}
	liveSpecAfter, err := os.ReadFile(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(liveSpecAfter) != string(liveSpecBefore) {
		t.Fatal("dry-run must not publish the new live spec")
	}
}

func TestApplyRelease_FirstEverReleaseVerifyFailureHasNoRollbackTarget(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	// Force VerifyHost's prefix-mode check to fail by pre-seeding an operator artifact in a
	// forbidden location (dataDir must not live under the wiki worktree).
	wikiRoot := filepath.Join(h.prefix, "srv/gdg-agent/wiki")
	if err := os.MkdirAll(filepath.Join(wikiRoot, ".xangi"), 0o755); err != nil {
		t.Fatal(err)
	}

	err := ApplyRelease(context.Background(), h.applyOpts(false, false))
	if err == nil {
		t.Fatal("expected verification failure to surface as an error")
	}
	if !strings.Contains(err.Error(), "no previously-installed release exists to automatically roll back to") {
		t.Fatalf("expected a loud no-rollback-target error, got: %v", err)
	}
	// The candidate never having passed verification, it must not have become the live spec.
	if fileExists(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json")) {
		t.Fatal("an unverified release must never be published as the live spec")
	}
}

func TestRollback_NoGenerationsInstalled(t *testing.T) {
	h := newReleaseTestHarness(t)
	err := Rollback(context.Background(), RollbackOptions{Prefix: h.prefix, ReleasesRoot: h.releasesRoot})
	if !errors.Is(err, ErrNoRollbackTarget) {
		t.Fatalf("expected ErrNoRollbackTarget, got: %v", err)
	}
}

func TestRollback_ExplicitToUnknownVersion(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("apply failed: %v", err)
	}

	err := Rollback(context.Background(), RollbackOptions{Prefix: h.prefix, ReleasesRoot: h.releasesRoot, To: "9.9.9"})
	if !errors.Is(err, ErrNoRollbackTarget) {
		t.Fatalf("expected ErrNoRollbackTarget for an uninstalled version, got: %v", err)
	}
}

func TestRollback_OldestGenerationHasNoImplicitTarget(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("apply failed: %v", err)
	}

	// Only one generation is installed and it is current: there is nothing "before" it.
	err := Rollback(context.Background(), RollbackOptions{Prefix: h.prefix, ReleasesRoot: h.releasesRoot})
	if !errors.Is(err, ErrNoRollbackTarget) {
		t.Fatalf("expected ErrNoRollbackTarget, got: %v", err)
	}
}

func TestRollback_RestoresPreviousGenerationAndPointer(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("v1 guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("apply v1 failed: %v", err)
	}

	buildTestReleaseFixture(t, h.fixtureDir, "2.0.0", testReleaseSpecJSON(t, "always"), map[string][]byte{
		"AGENTS.md": []byte("v2 guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("apply v2 failed: %v", err)
	}

	wikiRoot := filepath.Join(h.prefix, "srv/gdg-agent/wiki")
	mdc, err := os.ReadFile(filepath.Join(wikiRoot, ".cursor/rules/local.mdc"))
	if err != nil || !strings.Contains(string(mdc), "v2 guidance") {
		t.Fatalf("expected v2 content to be live before rollback: %s (err %v)", mdc, err)
	}

	if err := Rollback(context.Background(), RollbackOptions{Prefix: h.prefix, ReleasesRoot: h.releasesRoot}); err != nil {
		t.Fatalf("rollback failed: %v", err)
	}

	cur, err := CurrentReleaseVersion(h.releasesRoot)
	if err != nil || cur != "1.0.0" {
		t.Fatalf("expected current release 1.0.0 after rollback, got %q (err %v)", cur, err)
	}
	mdc, err = os.ReadFile(filepath.Join(wikiRoot, ".cursor/rules/local.mdc"))
	if err != nil || !strings.Contains(string(mdc), "v1 guidance") {
		t.Fatalf("expected v1 content to be restored after rollback: %s (err %v)", mdc, err)
	}
	liveSpec, err := os.ReadFile(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json"))
	if err != nil || !strings.Contains(string(liveSpec), `"completionNotify": "off"`) {
		t.Fatalf("expected v1 spec to be republished as live spec after rollback: %s (err %v)", liveSpec, err)
	}
}

func TestValidateWorkspaceDelegation(t *testing.T) {
	workspacePath := "/srv/gdg-agent/wiki"

	// The workspace root directory itself (managed for mode/ownership before any content exists)
	// is exempt.
	if err := ValidateWorkspaceDelegation([]Resource{
		&DirResource{Path: workspacePath},
	}, workspacePath); err != nil {
		t.Fatalf("expected the workspace root DirResource to be exempt, got: %v", err)
	}

	// A file strictly inside the workspace is a structural violation.
	err := ValidateWorkspaceDelegation([]Resource{
		&FileResource{Path: filepath.Join(workspacePath, "AGENTS.md")},
	}, workspacePath)
	if err == nil {
		t.Fatal("expected a FileResource inside paths.workspace to be rejected")
	}
	if !strings.Contains(err.Error(), "must be converged exclusively through the Tier 1") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// A directory strictly inside the workspace is likewise a violation.
	err = ValidateWorkspaceDelegation([]Resource{
		&DirResource{Path: filepath.Join(workspacePath, ".agents", "skills")},
	}, workspacePath)
	if err == nil {
		t.Fatal("expected a DirResource inside paths.workspace to be rejected")
	}

	// Unrelated resources and other resource types are untouched.
	if err := ValidateWorkspaceDelegation([]Resource{
		&FileResource{Path: "/opt/gdg-agent/bin/wk"},
	}, workspacePath); err != nil {
		t.Fatalf("unrelated resource must not trigger the invariant: %v", err)
	}
}

// TestReleaseGenerationsDirIsRootOnly is a regression guard for one of Stage 10's self-tamper
// invariants: no slot uid (gdgagent-run-<N>) or service account should be able to read or write
// release generations or the "current" pointer. Root ownership + 0700 achieves this structurally
// regardless of group membership -- assert plan.go keeps emitting exactly that.
func TestReleaseGenerationsDirIsRootOnly(t *testing.T) {
	prefix := t.TempDir()
	plan, err := BuildPlan(context.Background(), PlanOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4})
	if err != nil {
		t.Fatalf("BuildPlan failed: %v", err)
	}
	want := filepath.Join(plan.Paths.VarLibRoot, "releases")
	var found *DirResource
	for _, r := range plan.Resources {
		if dr, ok := r.(*DirResource); ok && dr.Path == want {
			found = dr
			break
		}
	}
	if found == nil {
		t.Fatalf("expected a DirResource for %s", want)
	}
	if found.Owner != "root" || found.Group != "root" {
		t.Fatalf("releases dir must be root:root, got %s:%s", found.Owner, found.Group)
	}
	if found.Mode&0o077 != 0 {
		t.Fatalf("releases dir must not grant group/other any access, got mode %o", found.Mode)
	}
}

// TestSandboxReadonlyPathsExcludeReleaseStore is a regression guard for the same self-tamper
// invariant on the OS-sandbox side: the cursor backend's additionalReadonlyPaths must never
// expose /var/lib/agent-host to a slot, even read-only (it would leak release generation content
// and the "current" pointer to every sandboxed invocation).
func TestSandboxReadonlyPathsExcludeReleaseStore(t *testing.T) {
	raw, err := backendConfigBytes("cursor", "sandbox.json.in")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "/var/lib/agent-host") {
		t.Fatal("cursor sandbox.json.in must not reference /var/lib/agent-host (release generation store)")
	}
}

func TestBuildPlanNeverEmitsGenericResourcesInsideWorkspace(t *testing.T) {
	// Regression guard for the Stage 10 structural invariant: whatever plan.go's resource list
	// grows to in the future, BuildPlan itself must keep rejecting (not merely happen to avoid)
	// any generic file/dir resource strictly inside paths.workspace.
	prefix := t.TempDir()
	plan, err := BuildPlan(context.Background(), PlanOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4})
	if err != nil {
		t.Fatalf("BuildPlan failed: %v", err)
	}
	if err := ValidateWorkspaceDelegation(plan.Resources, plan.Paths.WikiRoot); err != nil {
		t.Fatalf("BuildPlan's own resource set violates the workspace delegation invariant: %v", err)
	}
}

func TestApplyRelease_ConfigOverrideAppliesReleasesOwnConfig(t *testing.T) {
	h := newReleaseTestHarness(t)
	distinctiveKeyContent := "distinctive-content-from-the-release-not-the-embedded-default\n"
	buildTestReleaseFixtureFull(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"),
		map[string][]byte{
			"release-key.pub": []byte(distinctiveKeyContent),
		},
		map[string][]byte{
			"AGENTS.md": []byte("guidance"),
		}, h.privKey)

	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("ApplyRelease failed: %v", err)
	}

	deployed, err := os.ReadFile(filepath.Join(h.prefix, "opt/gdg-agent/lib/release-key.pub"))
	if err != nil {
		t.Fatalf("expected release-key.pub to be deployed: %v", err)
	}
	if string(deployed) != distinctiveKeyContent {
		t.Fatalf("expected the release's own config/release-key.pub to be deployed (config override), got: %q", deployed)
	}
}

func TestApplyRelease_ConfigOverrideFallsBackToEmbeddedWhenReleaseOmitsFile(t *testing.T) {
	// A release built before some config file existed must not break convergence of everything
	// else: configBytes/backendConfigBytes fall back to the embedded default for any file the
	// release's config/ subtree doesn't carry (here: no config/ subtree at all).
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("ApplyRelease failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.prefix, "opt/gdg-agent/lib/release-key.pub")); err != nil {
		t.Fatalf("expected the embedded default release-key.pub to be deployed as a fallback: %v", err)
	}
}

func TestApplyRelease_ReexecsToPinnedCLIBeforeApplyingNewPins(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	// testReleaseSpecJSON pins gdgCli to "0.3.1" with digests already in the approved allowlist
	// (matching the pattern in TestSelfReexec). CurrentVersion "9.9.9" forces a mismatch.
	t.Setenv("GDG_REEXEC_TEST_HOOK", "1")
	reexecCalled := false
	var reexecArgs []string
	opts := h.applyOpts(false, false)
	opts.CurrentVersion = "9.9.9"
	opts.Args = []string{"gdg", "agent-host", "release", "apply"}
	opts.ReexecFn = func(bin string, args []string) error {
		reexecCalled = true
		reexecArgs = args
		return nil // simulate a successful re-exec without replacing this test process
	}

	if err := ApplyRelease(context.Background(), opts); err != nil {
		t.Fatalf("ApplyRelease failed: %v", err)
	}
	if !reexecCalled {
		t.Fatal("expected a self re-exec when the extracted release's pins.gdgCli differs from CurrentVersion")
	}
	if len(reexecArgs) == 0 || reexecArgs[0] != "gdg" {
		t.Fatalf("expected re-exec args to be threaded through, got: %v", reexecArgs)
	}
}

func TestApplyRelease_ReexecNotTriggeredWhenPinsAlreadyMatch(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	t.Setenv("GDG_REEXEC_TEST_HOOK", "1")
	reexecCalled := false
	opts := h.applyOpts(false, false)
	opts.CurrentVersion = "0.3.1" // matches testReleaseSpecJSON's pins.gdgCli.version exactly
	opts.ReexecFn = func(bin string, args []string) error {
		reexecCalled = true
		return nil
	}

	if err := ApplyRelease(context.Background(), opts); err != nil {
		t.Fatalf("ApplyRelease failed: %v", err)
	}
	if reexecCalled {
		t.Fatal("must not re-exec when the running binary's version already matches pins.gdgCli")
	}
}

func TestApplyRelease_ApplyFailureAlsoTriggersRollback(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("v1 guidance"),
	}, h.privKey)
	if err := ApplyRelease(context.Background(), h.applyOpts(false, false)); err != nil {
		t.Fatalf("apply v1 failed: %v", err)
	}

	// v2's workspace subtree contains a path outside the Tier 1 managed set, which
	// ApplyWorkspaceFiles rejects -- a real failure inside applyReleaseGeneration's convergence
	// step, distinct from a later VerifyHost failure, exercising the OTHER rollback trigger.
	buildTestReleaseFixture(t, h.fixtureDir, "2.0.0", testReleaseSpecJSON(t, "always"), map[string][]byte{
		"AGENTS.md":        []byte("v2 guidance"),
		"not-managed/x.md": []byte("outside the Tier 1 boundary"),
	}, h.privKey)

	err := ApplyRelease(context.Background(), h.applyOpts(false, false))
	if err == nil {
		t.Fatal("expected the apply failure to surface as an error")
	}
	if !strings.Contains(err.Error(), "automatically rolled back to 1.0.0") {
		t.Fatalf("expected an apply failure to trigger automatic rollback, got: %v", err)
	}

	cur, err := CurrentReleaseVersion(h.releasesRoot)
	if err != nil || cur != "1.0.0" {
		t.Fatalf("expected current release to remain 1.0.0 after rollback, got %q (err %v)", cur, err)
	}
	wikiRoot := filepath.Join(h.prefix, "srv/gdg-agent/wiki")
	mdc, err := os.ReadFile(filepath.Join(wikiRoot, ".cursor/rules/local.mdc"))
	if err != nil || !strings.Contains(string(mdc), "v1 guidance") {
		t.Fatalf("expected v1 content to remain live after rollback: %s (err %v)", mdc, err)
	}
}

func TestApplyRelease_DryRunOnFirstEverReleaseNeverTouchesDurableStore(t *testing.T) {
	h := newReleaseTestHarness(t)
	buildTestReleaseFixture(t, h.fixtureDir, "1.0.0", testReleaseSpecJSON(t, "off"), map[string][]byte{
		"AGENTS.md": []byte("guidance"),
	}, h.privKey)

	err := ApplyRelease(context.Background(), h.applyOpts(true, true))
	if err == nil {
		t.Fatal("expected dry-run to report drift for a never-applied release")
	}
	if !errors.Is(err, ErrDriftDetected) {
		t.Fatalf("expected ErrDriftDetected, got: %v", err)
	}
	if cur, _ := CurrentReleaseVersion(h.releasesRoot); cur != "" {
		t.Fatalf("dry-run must not set a current pointer, got %q", cur)
	}
	if fileExists(filepath.Join(h.releasesRoot, "1.0.0")) {
		t.Fatal("dry-run must never promote a staged extraction into the durable release store")
	}
	if fileExists(filepath.Join(h.prefix, "etc/gdg-agent/agent-host.json")) {
		t.Fatal("dry-run must never publish a live spec")
	}
}
