package agenthost

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSystemdUnitResourceRendering(t *testing.T) {
	tmpDir := t.TempDir()

	plan, err := BuildPlan(context.Background(), PlanOptions{
		Prefix:    tmpDir,
		SlotCount: 4,
	})
	if err != nil {
		t.Fatalf("BuildPlan failed: %v", err)
	}

	var foundXangi, foundModel, foundLfService, foundLfTimer bool
	for _, ch := range plan.Changes {
		if strings.HasSuffix(ch.ResourceID, "xangi.service") {
			foundXangi = true
		}
		if strings.HasSuffix(ch.ResourceID, "model.conf") {
			foundModel = true
		}
		if strings.HasSuffix(ch.ResourceID, "langfuse-forwarder.service") {
			foundLfService = true
		}
		if strings.HasSuffix(ch.ResourceID, "langfuse-forwarder.timer") {
			foundLfTimer = true
		}
	}

	if !foundXangi {
		t.Errorf("xangi.service not found in plan")
	}
	if !foundModel {
		t.Errorf("model.conf not found in plan")
	}
	if !foundLfService {
		t.Errorf("langfuse-forwarder.service not found in plan")
	}
	if !foundLfTimer {
		t.Errorf("langfuse-forwarder.timer not found in plan")
	}

	// Now apply to tmpDir and check rendered file contents
	if err := ApplyPlan(context.Background(), plan, ApplyOptions{}); err != nil {
		t.Fatalf("ApplyPlan failed: %v", err)
	}

	modelConfPath := filepath.Join(tmpDir, "home", "gdgagent-svc", ".config", "systemd", "user", "xangi.service.d", "model.conf")
	modelContent, err := os.ReadFile(modelConfPath)
	if err != nil {
		t.Fatalf("failed to read model.conf: %v", err)
	}
	if !strings.Contains(string(modelContent), "AGENT_MODEL=composer-2.5") {
		t.Errorf("expected AGENT_MODEL=composer-2.5 in model.conf, got:\n%s", string(modelContent))
	}
}

func TestOverlayHarnessConfRendering(t *testing.T) {
	tmpDir := t.TempDir()

	overlayContent := `{
  "slotCount": 2,
  "systemd": {
    "dropIns": {
      "harness.conf": {
        "GDG_AGENT_HARNESS": "true",
        "SCHEDULER_ENABLED": "false",
        "XANGI_AGENT_SLOT_COUNT": "2",
        "GDG_WIKI_LOCK_OWNER": "lima-gdg-agent"
      }
    }
  }
}`
	overlayPath := filepath.Join(tmpDir, "agent-host.dev.json")
	if err := os.WriteFile(overlayPath, []byte(overlayContent), 0o644); err != nil {
		t.Fatalf("failed to write overlay: %v", err)
	}

	plan, err := BuildPlan(context.Background(), PlanOptions{
		OverlayPath: overlayPath,
		Prefix:      tmpDir,
	})
	if err != nil {
		t.Fatalf("BuildPlan failed: %v", err)
	}

	var foundHarness bool
	for _, ch := range plan.Changes {
		if strings.HasSuffix(ch.ResourceID, "harness.conf") {
			foundHarness = true
		}
	}
	if !foundHarness {
		t.Fatalf("harness.conf not planned when overlay is provided")
	}

	if err := ApplyPlan(context.Background(), plan, ApplyOptions{}); err != nil {
		t.Fatalf("ApplyPlan failed: %v", err)
	}

	harnessPath := filepath.Join(tmpDir, "home", "gdgagent-svc", ".config", "systemd", "user", "xangi.service.d", "harness.conf")
	data, err := os.ReadFile(harnessPath)
	if err != nil {
		t.Fatalf("failed to read harness.conf: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "Environment=GDG_AGENT_HARNESS=true") {
		t.Errorf("missing GDG_AGENT_HARNESS in harness.conf: %s", content)
	}
	if !strings.Contains(content, "Environment=GDG_WIKI_LOCK_OWNER=lima-gdg-agent") {
		t.Errorf("missing GDG_WIKI_LOCK_OWNER in harness.conf: %s", content)
	}
}

func TestExecResourceConditions(t *testing.T) {
	tmpDir := t.TempDir()

	pkgLock := filepath.Join(tmpDir, "package-lock.json")
	stateFile := filepath.Join(tmpDir, "node_modules", ".package-lock.sha256")
	nodeModules := filepath.Join(tmpDir, "node_modules")

	if err := os.MkdirAll(nodeModules, 0o755); err != nil {
		t.Fatal(err)
	}
	lockData := []byte(`{"name": "test", "lockfileVersion": 3}`)
	if err := os.WriteFile(pkgLock, lockData, 0o644); err != nil {
		t.Fatal(err)
	}

	h := sha256.Sum256(lockData)
	lockHash := hex.EncodeToString(h[:])
	if err := os.WriteFile(stateFile, []byte(lockHash+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	execRes := &ExecResource{
		Name:      "test-npm-ci",
		Command:   []string{"echo", "hi"},
		Dir:       tmpDir,
		WatchFile: pkgLock,
		StateFile: stateFile,
		CheckDir:  nodeModules,
	}

	// 1. Unchanged -> ActionNone
	ch, err := execRes.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch.Action != ActionNone {
		t.Errorf("expected ActionNone when state matches watchFile, got %v", ch.Action)
	}

	// 2. Modify watch file -> ActionUpdate
	newLockData := []byte(`{"name": "test-v2", "lockfileVersion": 3}`)
	if err := os.WriteFile(pkgLock, newLockData, 0o644); err != nil {
		t.Fatal(err)
	}
	ch2, err := execRes.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch2.Action != ActionUpdate {
		t.Errorf("expected ActionUpdate when watchFile modified, got %v", ch2.Action)
	}

	// 3. Missing CheckDir -> ActionUpdate even if watchfile matches
	if err := os.RemoveAll(nodeModules); err != nil {
		t.Fatal(err)
	}
	ch3, err := execRes.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch3.Action != ActionUpdate {
		t.Errorf("expected ActionUpdate when checkDir missing, got %v", ch3.Action)
	}

	// 4. Missing WatchFile -> ActionUpdate (pending creation, never skip)
	if err := os.Remove(pkgLock); err != nil {
		t.Fatal(err)
	}
	ch4, err := execRes.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch4.Action != ActionUpdate {
		t.Errorf("expected ActionUpdate when watchFile missing, got %v", ch4.Action)
	}
}

func TestWikiCloneResource(t *testing.T) {
	tmpDir := t.TempDir()
	wikiDir := filepath.Join(tmpDir, "srv", "gdg-agent", "wiki")

	res := &WikiCloneResource{
		WikiRoot: wikiDir,
		Prefix:   tmpDir,
		User:     "nobody",
	}

	// In prefix mode -> ActionNone
	ch, err := res.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch.Action != ActionNone {
		t.Errorf("expected ActionNone in prefix mode, got %v", ch.Action)
	}

	// In non-prefix without credentials -> ActionNone (clean skip)
	res.Prefix = ""
	ch2, err := res.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch2.Action != ActionNone {
		t.Errorf("expected ActionNone when credentials missing, got %v", ch2.Action)
	}

	// With existing .git -> ActionNone
	if err := os.MkdirAll(filepath.Join(wikiDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	ch3, err := res.Plan(context.Background())
	if err != nil {
		t.Fatalf("Plan failed: %v", err)
	}
	if ch3.Action != ActionNone {
		t.Errorf("expected ActionNone when .git exists, got %v", ch3.Action)
	}
}

func TestSelfReexec(t *testing.T) {
	reexecCalled := false
	var reexecBin string
	var reexecArgs []string

	mockReexec := func(bin string, args []string) error {
		reexecCalled = true
		reexecBin = bin
		reexecArgs = args
		return nil
	}

	spec := SpecFile{
		Environment: "production",
		Backend: BackendSpec{
			Name:  "cursor",
			Model: "composer-2.5",
			Isolation: IsolationSpec{
				SlotLauncher: true,
				OSSandbox:    "workspace",
				ToolGate:     "preToolUse-failClosed",
			},
		},
		Pins: PinsSpec{
			GdgCli: GdgCliPin{
				Version: "0.1.4",
				SHA256: map[string]string{
					"x86_64":  "0d8affab878ab1ba9c7f8df9efae1a47964db9bfb356592d7ee43a23ec14be3b",
					"aarch64": "5dbf544d0cf9ed34cce688fbb6e40fc1e5cbc3719ff50a2a1e62438729bb07a0",
				},
			},
		},
	}

	// In dev mode without force, no reexec
	err := CheckAndReexecSelf(context.Background(), "dev", spec, []string{"gdg", "agent-host", "apply"}, mockReexec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reexecCalled {
		t.Errorf("expected no re-exec in dev mode")
	}

	// Same version -> no reexec
	err = CheckAndReexecSelf(context.Background(), "0.1.4", spec, []string{"gdg", "agent-host", "apply"}, mockReexec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if reexecCalled {
		t.Errorf("expected no re-exec when version matches")
	}

	// Mismatched version with test hook
	t.Setenv("GDG_REEXEC_TEST_HOOK", "1")
	err = CheckAndReexecSelf(context.Background(), "0.1.3", spec, []string{"gdg", "agent-host", "apply"}, mockReexec)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reexecCalled {
		t.Errorf("expected re-exec when version mismatches")
	}
	if reexecBin != "/usr/local/bin/gdg" {
		t.Errorf("expected reexec bin /usr/local/bin/gdg, got %s", reexecBin)
	}
	if len(reexecArgs) != 3 || reexecArgs[0] != "gdg" {
		t.Errorf("expected args [gdg agent-host apply], got %v", reexecArgs)
	}
}

func TestTarballContainmentCheck(t *testing.T) {
	tmpDir := t.TempDir()
	archivePath := filepath.Join(tmpDir, "malicious.tar.gz")

	// Create malicious tar.gz containing path traversal member
	f, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	gw := gzip.NewWriter(f)
	tw := tar.NewWriter(gw)

	header := &tar.Header{
		Name:     "package/../../evil.txt",
		Mode:     0o644,
		Size:     4,
		Typeflag: tar.TypeReg,
	}
	if err := tw.WriteHeader(header); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write([]byte("evil")); err != nil {
		t.Fatal(err)
	}
	tw.Close()
	gw.Close()
	f.Close()

	destDir := filepath.Join(tmpDir, "extract_target")
	err = extractTarGzDir(archivePath, destDir, 1)
	if err == nil {
		t.Fatalf("expected error for escaping archive entry, got nil")
	}
	if !strings.Contains(err.Error(), "insecure archive entry escapes destination directory") {
		t.Fatalf("expected traversal containment error, got: %v", err)
	}
}
