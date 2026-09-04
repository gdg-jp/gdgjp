package agenthost

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestConvergerIdempotence(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	planOpts := PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 4,
	}

	// 1st Plan and Apply
	plan1, err := BuildPlan(context.Background(), planOpts)
	if err != nil {
		t.Fatal(err)
	}
	if !plan1.HasChanges() {
		t.Fatal("expected first plan to have changes for a clean prefix")
	}
	if err := ApplyPlan(context.Background(), plan1, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	// 2nd Plan must have 0 changes
	plan2, err := BuildPlan(context.Background(), planOpts)
	if err != nil {
		t.Fatal(err)
	}
	if plan2.HasChanges() {
		t.Fatalf("expected 2nd plan to have 0 changes, got %d:\n%s", plan2.ChangeCount(), plan2.DiffSummary())
	}

	// 2nd Apply must report no changes
	if err := ApplyPlan(context.Background(), plan2, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
}

func TestDryRunDriftDetection(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	planOpts := PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 4,
	}

	// First plan has drift against empty prefix -> dry-run must fail with ErrDriftDetected
	plan1, err := BuildPlan(context.Background(), planOpts)
	if err != nil {
		t.Fatal(err)
	}
	err = ApplyPlan(context.Background(), plan1, ApplyOptions{DryRun: true})
	if err == nil || !errors.Is(err, ErrDriftDetected) {
		t.Fatalf("expected ErrDriftDetected, got: %v", err)
	}

	// Apply cleanly
	if err := ApplyPlan(context.Background(), plan1, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	// Second dry-run when converged must succeed
	plan2, err := BuildPlan(context.Background(), planOpts)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), plan2, ApplyOptions{DryRun: true}); err != nil {
		t.Fatalf("expected dry-run to succeed on converged host, got: %v", err)
	}
}

func TestSlotReductionPruning(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	// 1. Initial 4 slots
	plan4, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), plan4, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	// Plant an auth.json in slot 2 and slot 3 home
	authPath2 := filepath.Join(prefix, "home/gdgagent-run-2/.config/cursor/auth.json")
	authPath3 := filepath.Join(prefix, "home/gdgagent-run-3/.config/cursor/auth.json")
	_ = os.MkdirAll(filepath.Dir(authPath2), 0o700)
	_ = os.MkdirAll(filepath.Dir(authPath3), 0o700)
	if err := os.WriteFile(authPath2, []byte(`{"token":"secret-slot-2"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(authPath3, []byte(`{"token":"secret-slot-3"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	// 2. Reduce slot count to 2 WITHOUT prune: home dirs and auth.json must NOT be deleted
	planNoPrune, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 2,
		Prune:     false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), planNoPrune, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(authPath2); os.IsNotExist(err) {
		t.Fatal("without --prune, slot 2 home and auth.json must NOT be deleted")
	}
	if _, err := os.Stat(authPath3); os.IsNotExist(err) {
		t.Fatal("without --prune, slot 3 home and auth.json must NOT be deleted")
	}

	// 3. Reduce slot count to 2 WITH prune: home dirs and auth.json must be pruned
	planPrune, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 2,
		Prune:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), planPrune, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(authPath2); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 2 auth.json must be deleted")
	}
	if _, err := os.Stat(authPath3); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 3 auth.json must be deleted")
	}
	if _, err := os.Stat(filepath.Join(prefix, "home/gdgagent-run-2")); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 2 home dir must be deleted")
	}
	if _, err := os.Stat(filepath.Join(prefix, "home/gdgagent-run-3")); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 3 home dir must be deleted")
	}
	if _, err := os.Stat(filepath.Join(prefix, "run/gdg-agent/2")); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 2 run dir must be deleted")
	}
	if _, err := os.Stat(filepath.Join(prefix, "run/gdg-agent/3")); !os.IsNotExist(err) {
		t.Fatal("with --prune, slot 3 run dir must be deleted")
	}
}

func TestRenderLayoutMatchesEmitLayout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	dirEmit := t.TempDir()
	dirRender := t.TempDir()

	if err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), Prefix: dirEmit, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}
	if err := RenderLayout(defaultSpec(t), "", dirRender, 4); err != nil {
		t.Fatal(err)
	}

	snapEmit, err := snapshotLayout(dirEmit)
	if err != nil {
		t.Fatal(err)
	}
	snapRender, err := snapshotLayout(dirRender)
	if err != nil {
		t.Fatal(err)
	}

	jsonEmit, _ := json.MarshalIndent(snapEmit, "", "  ")
	jsonRender, _ := json.MarshalIndent(snapRender, "", "  ")
	if string(jsonEmit) != string(jsonRender) {
		t.Fatalf("render output does not match emit-layout:\n%s", firstGoldenDiff(snapEmit, snapRender))
	}
}

func TestSemanticInvariants(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	if err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}

	// 1. Sudoers has no wildcards
	sudoersRaw, err := os.ReadFile(filepath.Join(prefix, "etc/sudoers.d/gdg-agent"))
	if err != nil {
		t.Fatal(err)
	}
	sudoers := string(sudoersRaw)
	for _, line := range strings.Split(sudoers, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		if strings.ContainsAny(line, "*?") {
			t.Fatalf("sudoers contains wildcard: %s", line)
		}
	}

	// 2. AdditionalReadonlyPaths contains /run/gdg-agent/0 but NOT parent /run/gdg-agent
	sandboxRaw, err := os.ReadFile(filepath.Join(prefix, "home/gdgagent-run-0/.cursor/sandbox.json"))
	if err != nil {
		t.Fatal(err)
	}
	var sandbox struct {
		AdditionalReadonlyPaths []string `json:"additionalReadonlyPaths"`
	}
	if err := json.Unmarshal(sandboxRaw, &sandbox); err != nil {
		t.Fatal(err)
	}
	hasSlotRun := false
	for _, p := range sandbox.AdditionalReadonlyPaths {
		if p == "/run/gdg-agent/0" {
			hasSlotRun = true
		}
		if p == "/run/gdg-agent" {
			t.Fatal("additionalReadonlyPaths must NOT contain parent /run/gdg-agent")
		}
	}
	if !hasSlotRun {
		t.Fatal("additionalReadonlyPaths missing /run/gdg-agent/0")
	}

	// 3. Sandbox does not contain .config/gdg or .config/xangi
	if strings.Contains(string(sandboxRaw), ".config/gdg") || strings.Contains(string(sandboxRaw), ".config/xangi") {
		t.Fatal("sandbox contains operator credentials directory path")
	}

	// 4. Hooks failClosed is true
	hooksRaw, err := os.ReadFile(filepath.Join(prefix, "home/gdgagent-run-0/.cursor/hooks.json"))
	if err != nil {
		t.Fatal(err)
	}
	var hooks struct {
		Hooks struct {
			PreToolUse []struct {
				FailClosed bool `json:"failClosed"`
			} `json:"preToolUse"`
		} `json:"hooks"`
	}
	if err := json.Unmarshal(hooksRaw, &hooks); err != nil {
		t.Fatal(err)
	}
	if len(hooks.Hooks.PreToolUse) == 0 || !hooks.Hooks.PreToolUse[0].FailClosed {
		t.Fatal("hooks.json missing failClosed: true on preToolUse")
	}
}

func TestFileResourceAtomicSafeWrite(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "live.txt")
	initialContent := []byte("hello initial")
	if err := os.WriteFile(target, initialContent, 0o644); err != nil {
		t.Fatal(err)
	}

	// 1. Injected failure between temp-write and rename: target must remain completely untouched
	injectedErr := errors.New("simulated failure before rename")
	failingRes := &FileResource{
		Path:                 target,
		Data:                 []byte("malformed/incomplete content"),
		Mode:                 0o644,
		testBeforeRenameHook: func() error { return injectedErr },
	}
	failingChange, err := failingRes.Plan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	applyErr := failingRes.Apply(context.Background(), failingChange)
	if !errors.Is(applyErr, injectedErr) {
		t.Fatalf("expected injectedErr, got %v", applyErr)
	}

	// Existing file must be pristine
	preserved, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(preserved) != "hello initial" {
		t.Fatalf("target was corrupted by failed write: got %s", string(preserved))
	}

	// No leftover temp files in directory
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") {
			t.Fatalf("found leaked temporary file %s", e.Name())
		}
	}

	// 2. Normal apply success
	res := &FileResource{
		Path: target,
		Data: []byte("updated content"),
		Mode: 0o644,
	}

	// Test Plan
	change, err := res.Plan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if change.Action != ActionUpdate {
		t.Fatalf("expected ActionUpdate, got %s", change.Action)
	}

	// Test Apply
	if err := res.Apply(context.Background(), change); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "updated content" {
		t.Fatalf("got %s", string(got))
	}
}

func TestBuildPlanRejectsInvalidOnlyFilter(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	invalidCases := []string{
		"usre",
		"user,",
		",user",
		"file,unknown",
	}

	for _, tc := range invalidCases {
		_, err := BuildPlan(context.Background(), PlanOptions{
			SpecPath:  defaultSpec(t),
			Prefix:    prefix,
			SlotCount: 2,
			Only:      tc,
		})
		if err == nil {
			t.Fatalf("expected error for invalid --only filter %q, got nil", tc)
		}
	}

	// Valid cases must succeed
	validCases := []string{
		"user",
		"user,file",
		"dir,sudoers,tmpfiles",
	}
	for _, tc := range validCases {
		_, err := BuildPlan(context.Background(), PlanOptions{
			SpecPath:  defaultSpec(t),
			Prefix:    prefix,
			SlotCount: 2,
			Only:      tc,
		})
		if err != nil {
			t.Fatalf("unexpected error for valid --only filter %q: %v", tc, err)
		}
	}
}

func TestLiveOperationsRequireRoot(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("skipping non-root check when running as root")
	}

	_, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    "", // live paths
		SlotCount: 2,
	})
	if !errors.Is(err, ErrNeedRoot) {
		t.Fatalf("expected ErrNeedRoot for live BuildPlan as non-root, got: %v", err)
	}
}

func TestFileResourceSymlinkDoesNotChmodTarget(t *testing.T) {
	dir := t.TempDir()
	sensitiveTarget := filepath.Join(dir, "sensitive.txt")
	if err := os.WriteFile(sensitiveTarget, []byte("sensitive content"), 0o400); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(dir, "link.txt")
	if err := os.Symlink(sensitiveTarget, symlinkPath); err != nil {
		t.Fatal(err)
	}

	// Apply managed file over symlinkPath
	res := &FileResource{
		Path: symlinkPath,
		Data: []byte("replacement file"),
		Mode: 0o644,
	}
	change, err := res.Plan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := res.Apply(context.Background(), change); err != nil {
		t.Fatal(err)
	}

	// Target must retain 0400 mode and original content
	targetInfo, err := os.Stat(sensitiveTarget)
	if err != nil {
		t.Fatal(err)
	}
	if targetInfo.Mode().Perm() != 0o400 {
		t.Fatalf("sensitive target mode was modified: expected 0400, got %s", targetInfo.Mode().Perm())
	}
	targetContent, err := os.ReadFile(sensitiveTarget)
	if err != nil {
		t.Fatal(err)
	}
	if string(targetContent) != "sensitive content" {
		t.Fatalf("sensitive target was overwritten: %s", string(targetContent))
	}

	// symlinkPath must now be a regular file with replacement content
	linkInfo, err := os.Lstat(symlinkPath)
	if err != nil {
		t.Fatal(err)
	}
	if linkInfo.Mode()&os.ModeSymlink != 0 {
		t.Fatal("expected symlink to be replaced by regular file")
	}
}

func TestDirResourceSymlinkSafeUnlink(t *testing.T) {
	dir := t.TempDir()
	sensitiveDir := filepath.Join(dir, "sensitive_dir")
	if err := os.Mkdir(sensitiveDir, 0o700); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(dir, "managed_dir")
	if err := os.Symlink(sensitiveDir, symlinkPath); err != nil {
		t.Fatal(err)
	}

	res := &DirResource{
		Path: symlinkPath,
		Mode: 0o755,
	}
	change, err := res.Plan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if change.Action != ActionUpdate {
		t.Fatalf("expected ActionUpdate for symlink at dir path, got %s", change.Action)
	}

	if err := res.Apply(context.Background(), change); err != nil {
		t.Fatal(err)
	}

	// managed_dir must now be a genuine directory, NOT a symlink
	info, err := os.Lstat(symlinkPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		t.Fatalf("expected managed_dir to be real directory, got mode %v", info.Mode())
	}

	// sensitiveDir must retain 0700 mode
	sensInfo, err := os.Lstat(sensitiveDir)
	if err != nil {
		t.Fatal(err)
	}
	if sensInfo.Mode().Perm() != 0o700 {
		t.Fatalf("sensitive dir mode was modified: %v", sensInfo.Mode().Perm())
	}
}

func TestPruneAndOnlyFiltering(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	// Initial apply with 4 slots
	plan4, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), plan4, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	// Create an undeclared bin file
	staleBin := filepath.Join(prefix, "opt/gdg-agent/bin/stale-tool")
	if err := os.WriteFile(staleBin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	// 1. apply --only user WITHOUT --prune: staleBin must NOT be deleted
	planOnlyUser, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 2,
		Only:      "user",
		Prune:     false,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), planOnlyUser, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staleBin); os.IsNotExist(err) {
		t.Fatal("apply --only user without --prune must NOT delete unknown bin files")
	}

	// 2. apply --only file WITH --prune: staleBin IS planned and deleted, but slot 2 run dir is not deleted
	planOnlyFilePrune, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: 2,
		Only:      "file",
		Prune:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	hasStaleBinDelete := false
	for _, c := range planOnlyFilePrune.Changes {
		if c.ResourceID == staleBin && c.Action == ActionDelete {
			hasStaleBinDelete = true
		}
	}
	if !hasStaleBinDelete {
		t.Fatal("expected staleBin to be planned as explicit ActionDelete resource")
	}

	if err := ApplyPlan(context.Background(), planOnlyFilePrune, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staleBin); !os.IsNotExist(err) {
		t.Fatal("staleBin should be deleted after apply --only file --prune")
	}
	if _, err := os.Stat(filepath.Join(prefix, "run/gdg-agent/2")); os.IsNotExist(err) {
		t.Fatal("run/gdg-agent/2 must NOT be deleted when applying --only file")
	}
}

func TestScanAccountSlotsDiscovery(t *testing.T) {
	passwdData := []byte("root:x:0:0:root:/root:/bin/bash\n" +
		"gdgagent-svc:x:998:998::/home/gdgagent-svc:/usr/sbin/nologin\n" +
		"gdgagent-run-0:x:1001:1001::/home/gdgagent-run-0:/usr/sbin/nologin\n" +
		"gdgagent-run-1:x:1002:1002::/home/gdgagent-run-1:/usr/sbin/nologin\n" +
		"gdgagent-run-4:x:1005:1005::/home/gdgagent-run-4:/usr/sbin/nologin\n" +
		"gdgagent-run-2:x:1003:1003::/home/gdgagent-run-2:/usr/sbin/nologin\n")

	groupData := []byte("root:x:0:\n" +
		"gdgagent-run-5:x:1006:\n" +
		"gdgagent-run-3:x:1004:\n")

	seen := make(map[int]bool)
	slotCount := 2
	scanColonEntries(passwdData, seen, slotCount)
	scanColonEntries(groupData, seen, slotCount)

	// Discovered slots should be 2, 3, 4, 5 (slots >= slotCount 2)
	for _, expected := range []int{2, 3, 4, 5} {
		if !seen[expected] {
			t.Fatalf("expected slot %d to be discovered from account entries", expected)
		}
	}
	if seen[0] || seen[1] {
		t.Fatal("slots < slotCount must not be marked for pruning")
	}
}
