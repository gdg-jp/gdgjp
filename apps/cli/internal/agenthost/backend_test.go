package agenthost

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func validProductionSpec() SpecFile {
	return SpecFile{
		Environment: "production",
		SlotCount:   4,
		Backend: BackendSpec{
			Name:  "cursor",
			Model: "composer-2.5",
			Isolation: IsolationSpec{
				SlotLauncher: true,
				OSSandbox:    "workspace",
				ToolGate:     "preToolUse-failClosed",
			},
		},
		Discord: DiscordSpec{
			ShowThinking:     false,
			Streaming:        false,
			CompletionNotify: "off",
		},
		Pins: PinsSpec{
			CursorAgent: CursorAgentPin{
				Version: "2026.08.11-e8db854",
				SHA256: map[string]string{
					"x86_64":  "bfff4bf6f4e9dd30c1d0ef0a70b6077b074015dd2948e4c50685d53afdcfce5a",
					"aarch64": "ea13f92e295f523a99ce8d8f57d6894d21e5d1e2d030ffad718ccd5955ca2eed",
				},
			},
			Xangi: XangiPin{
				Repo: "https://github.com/gdg-jp/xangi.git",
				Ref:  "b3db5919a5e33769ef8d7bcef245aa6b76974948",
			},
			GWS: GWSPin{
				Version: "v0.22.5",
				SHA256: map[string]string{
					"x86_64":  "de78ecdbd2f1a84cca0063a7ecbc440240fc14b6ebccbb17f4646b792a8c5c1f",
					"aarch64": "94490295d9580e1e88574e715a0a162991747d12d62f8c7b8dcc8268b6c1cea0",
				},
			},
			GdgCli: GdgCliPin{
				Version:       "0.4.0",
				AssetTemplate: "gdg_{version}_linux_{arch}.zip",
				SHA256: map[string]string{
					"x86_64":  "9235020b3516695bef999feea00745dd0542c932eb93a7c01fff684070de2fb1",
					"aarch64": "1d4513e571794b6b9843852ffd64d2c7f0087757e6597611eb0e97e3fe778fef",
				},
			},
			Node: NodePin{
				Major:    22,
				MinMinor: 18,
			},
		},
		Paths: PathsSpec{
			AgentRoot: "/opt/gdg-agent",
			Workspace: "/srv/gdg-agent/wiki",
			RunRoot:   "/run/gdg-agent",
		},
	}
}

// 1. backend.name を antigravity にした spec で apply が非ゼロで落ち、ホストが無変更のまま
// 2. エラーメッセージが「どの層が、どのバックエンドで、なぜ足りないか」を明示する
func TestAntigravityBackendFailsClosedAndLeavesHostUntouched(t *testing.T) {
	prefix := t.TempDir()
	spec := validProductionSpec()
	spec.Backend.Name = "antigravity"

	// Write spec to temp file
	specPath := filepath.Join(prefix, "agent-host.json")
	specBytes, err := os.ReadFile("assets/agent-host.json")
	if err != nil {
		t.Fatal(err)
	}
	modifiedJSON := strings.Replace(string(specBytes), `"name": "cursor"`, `"name": "antigravity"`, 1)
	if err := os.WriteFile(specPath, []byte(modifiedJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	_, planErr := BuildPlan(context.Background(), PlanOptions{
		SpecPath: specPath,
		Prefix:   prefix,
	})
	if planErr == nil {
		t.Fatalf("expected BuildPlan to fail with antigravity backend, but got nil")
	}

	errMsg := planErr.Error()
	expectedSubstrings := []string{
		`error: backend "antigravity" does not satisfy required isolation`,
		`osSandbox:    required "workspace", but antigravity provides "none"`,
		`toolGate:     required "preToolUse-failClosed", but antigravity provides "none"`,
	}
	for _, expected := range expectedSubstrings {
		if !strings.Contains(errMsg, expected) {
			t.Errorf("error message missing expected explanation %q; got:\n%s", expected, errMsg)
		}
	}
	// Stage 12 lifted slot isolation into CliRunnerBase for every adapter, so antigravity
	// now satisfies slotLauncher — only osSandbox and toolGate remain blocking. Stage 14
	// (ADR-032) implemented the toolGate mechanism (acl-gate.ts reuse, root-owned per-slot
	// hooks.json) and end-to-end tested it against an unpinned agy, but its code-review
	// follow-up requires a pinned+checksummed agy version and an E2E test against that exact
	// binary before the registry may claim toolGate: the mechanism working on one unpinned
	// dev build isn't the same guarantee as "this is what production runs". So toolGate stays
	// a blocking reason here until pins.antigravity is set (see ADR-032 residual tasks).
	if strings.Contains(errMsg, "slotLauncher") {
		t.Errorf("slotLauncher should no longer be a failure for antigravity after Stage 12; got:\n%s", errMsg)
	}

	// Verify host is untouched: prefix should contain only the test spec file
	entries, err := os.ReadDir(prefix)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "agent-host.json" {
		t.Fatalf("expected host prefix to remain untouched (only agent-host.json exists), but found %d entries", len(entries))
	}
}

// 3b. Stage 12 が antigravity の SlotLauncher を true にした後の状態を固定する:
// レジストリは true を返すが、production への切り替えは osSandbox/toolGate の欠如で
// 依然として拒否される（Stage 14 待ち）。development では slotLauncher だけを要求する
// spec が素通りすることも確認する。
func TestAntigravitySlotLauncherSatisfiedAfterStage12(t *testing.T) {
	caps, ok := GetBackendCapabilities("antigravity")
	if !ok {
		t.Fatal("expected antigravity to be a known backend")
	}
	if !caps.SlotLauncher {
		t.Fatalf("expected antigravity.SlotLauncher to be true after Stage 12, got false")
	}

	// development spec requiring only slotLauncher passes the capability check.
	devSpec := validProductionSpec()
	devSpec.Environment = "development"
	devSpec.Backend.Name = "antigravity"
	devSpec.Backend.Isolation = IsolationSpec{SlotLauncher: true, OSSandbox: "none", ToolGate: "none"}
	if err := ValidateBackendContract(devSpec); err != nil {
		t.Fatalf("expected development spec requiring only slotLauncher to pass, got: %v", err)
	}

	// production spec still requires the full contract, so switching to antigravity
	// remains rejected for osSandbox and toolGate — only slotLauncher (Stage 12) is
	// satisfied. toolGate's mechanism is implemented (Stage 14/ADR-032) but the registry
	// withholds the guarantee until a pinned+checksummed agy version passes its own E2E
	// deny test (see ADR-032 residual tasks and its code-review follow-up).
	prodSpec := validProductionSpec()
	prodSpec.Backend.Name = "antigravity"
	err := ValidateBackendContract(prodSpec)
	if err == nil {
		t.Fatalf("expected production spec to still reject antigravity (osSandbox/toolGate pending)")
	}
	if strings.Contains(err.Error(), "slotLauncher") {
		t.Errorf("slotLauncher must not appear in the rejection reason after Stage 12; got: %v", err)
	}
	if !strings.Contains(err.Error(), "osSandbox") || !strings.Contains(err.Error(), "toolGate") {
		t.Errorf("expected rejection to cite osSandbox and toolGate, got: %v", err)
	}
}

// 4. isolation を下げた production spec が apply で落ちる
func TestLoweredIsolationInProductionSpecFailsProductionMinimum(t *testing.T) {
	// Case A: toolGate lowered to "none"
	specA := validProductionSpec()
	specA.Backend.Isolation.ToolGate = "none"
	errA := ValidateBackendContract(specA)
	if errA == nil {
		t.Fatalf("expected contract validation to fail when toolGate is lowered in production")
	}
	if !strings.Contains(errA.Error(), "production minimum requirements") || !strings.Contains(errA.Error(), "toolGate") {
		t.Errorf("unexpected error message for lowered toolGate: %v", errA)
	}

	// Case B: osSandbox lowered to "none"
	specB := validProductionSpec()
	specB.Backend.Isolation.OSSandbox = "none"
	errB := ValidateBackendContract(specB)
	if errB == nil {
		t.Fatalf("expected contract validation to fail when osSandbox is lowered in production")
	}
	if !strings.Contains(errB.Error(), "production minimum requirements") || !strings.Contains(errB.Error(), "osSandbox") {
		t.Errorf("unexpected error message for lowered osSandbox: %v", errB)
	}

	// Case C: slotLauncher lowered to false
	specC := validProductionSpec()
	specC.Backend.Isolation.SlotLauncher = false
	errC := ValidateBackendContract(specC)
	if errC == nil {
		t.Fatalf("expected contract validation to fail when slotLauncher is lowered in production")
	}
	if !strings.Contains(errC.Error(), "production minimum requirements") || !strings.Contains(errC.Error(), "slotLauncher") {
		t.Errorf("unexpected error message for lowered slotLauncher: %v", errC)
	}

	// Case D: antigravity with lowered isolation in production fails production minimum
	specD := validProductionSpec()
	specD.Backend.Name = "antigravity"
	specD.Backend.Isolation = IsolationSpec{
		SlotLauncher: false,
		OSSandbox:    "none",
		ToolGate:     "none",
	}
	errD := ValidateBackendContract(specD)
	if errD == nil {
		t.Fatalf("expected contract validation to fail for antigravity with lowered isolation in production")
	}
	if !strings.Contains(errD.Error(), "production minimum requirements") {
		t.Errorf("expected production minimum violation, got: %v", errD)
	}
}

// 5. productionMinimum が spec・config・バンドルから読み込まれていない（不変のコンパイル値）
func TestProductionMinimumIsHardcodedBaseline(t *testing.T) {
	min := GetProductionMinimum()
	if !min.SlotLauncher {
		t.Errorf("productionMinimum.SlotLauncher must be true")
	}
	if min.OSSandbox != "workspace" {
		t.Errorf("productionMinimum.OSSandbox must be 'workspace', got %q", min.OSSandbox)
	}
	if min.ToolGate != "preToolUse-failClosed" {
		t.Errorf("productionMinimum.ToolGate must be 'preToolUse-failClosed', got %q", min.ToolGate)
	}
}

// 6. pins.gdgCli を緩い下限のバイナリに向けた production spec で、re-exec が起きる前に現行バイナリが落とす
func TestReexecHoleDefense_RelaxedProductionSpecRejectedBeforeReexec(t *testing.T) {
	spec := validProductionSpec()
	// Attempt to lower isolation in production spec
	spec.Backend.Isolation.ToolGate = "none"
	// Point to a different CLI version to trigger re-exec condition
	spec.Pins.GdgCli.Version = "0.1.4"
	spec.Pins.GdgCli.SHA256 = map[string]string{
		"x86_64":  "0d8affab878ab1ba9c7f8df9efae1a47964db9bfb356592d7ee43a23ec14be3b",
		"aarch64": "5dbf544d0cf9ed34cce688fbb6e40fc1e5cbc3719ff50a2a1e62438729bb07a0",
	}

	reexecCalled := false
	mockReexec := func(bin string, args []string) error {
		reexecCalled = true
		return nil
	}

	err := CheckAndReexecSelf(context.Background(), "0.3.1", spec, []string{"gdg", "agent-host", "apply"}, mockReexec)
	if err == nil {
		t.Fatalf("expected CheckAndReexecSelf to fail on production minimum violation before re-exec")
	}
	if !strings.Contains(err.Error(), "self re-exec blocked") || !strings.Contains(err.Error(), "production minimum") {
		t.Errorf("unexpected error message: %v", err)
	}
	if reexecCalled {
		t.Fatalf("CRITICAL SECURITY VIOLATION: reexec was invoked despite production minimum violation!")
	}
}

// 7. allowlist に無いダイジェストの gdg へ re-exec しない
func TestReexecHoleDefense_UnapprovedDigestRejected(t *testing.T) {
	spec := validProductionSpec()
	spec.Pins.GdgCli.Version = "0.9.9"
	spec.Pins.GdgCli.SHA256 = map[string]string{
		"x86_64":  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		"aarch64": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	}

	reexecCalled := false
	mockReexec := func(bin string, args []string) error {
		reexecCalled = true
		return nil
	}

	err := CheckAndReexecSelf(context.Background(), "0.3.1", spec, []string{"gdg", "agent-host", "apply"}, mockReexec)
	if err == nil {
		t.Fatalf("expected CheckAndReexecSelf to fail on unapproved digest")
	}
	if !strings.Contains(err.Error(), "not in approved release allowlist") {
		t.Errorf("unexpected error message: %v", err)
	}
	if reexecCalled {
		t.Fatalf("CRITICAL SECURITY VIOLATION: reexec was invoked with unapproved digest!")
	}
}

// 7b. Injected validator allows testing without environment variable escape hatches
func TestReexecInjectedValidator(t *testing.T) {
	spec := validProductionSpec()
	customSHA := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	spec.Pins.GdgCli.Version = "0.9.9"
	spec.Pins.GdgCli.SHA256 = map[string]string{
		"x86_64":  customSHA,
		"aarch64": customSHA,
	}

	t.Setenv("GDG_REEXEC_TEST_HOOK", "1")

	reexecCalled := false
	mockReexec := func(bin string, args []string) error {
		reexecCalled = true
		return nil
	}

	// 1. Injected validator rejecting customSHA
	err := CheckAndReexecSelfWithValidator(context.Background(), "0.3.1", spec, []string{"gdg", "agent-host", "apply"}, mockReexec, func(d string) bool {
		return false
	})
	if err == nil {
		t.Fatalf("expected CheckAndReexecSelfWithValidator to fail when validator returns false")
	}
	if reexecCalled {
		t.Fatalf("reexec called when validator returned false")
	}

	// 2. Injected validator approving customSHA
	err = CheckAndReexecSelfWithValidator(context.Background(), "0.3.1", spec, []string{"gdg", "agent-host", "apply"}, mockReexec, func(d string) bool {
		return d == customSHA
	})
	if err != nil {
		t.Fatalf("expected CheckAndReexecSelfWithValidator to succeed with custom validator, got: %v", err)
	}
	if !reexecCalled {
		t.Fatalf("expected reexec to be invoked with approved custom validator")
	}
}

// 8. environment: "development" の spec がリリース CI で弾かれる
func TestDevelopmentSpecAllowedLocallyButRejectedForRelease(t *testing.T) {
	spec := validProductionSpec()
	spec.Environment = "development"
	spec.Backend.Name = "antigravity"
	spec.Backend.Isolation = IsolationSpec{
		SlotLauncher: false,
		OSSandbox:    "none",
		ToolGate:     "none",
	}

	// In development, contract passes because production minimum is not enforced
	if err := ValidateBackendContract(spec); err != nil {
		t.Fatalf("expected development contract to pass, got: %v", err)
	}

	// But release validation strictly rejects development specs
	err := ValidateSpecForRelease(spec)
	if err == nil {
		t.Fatalf("expected ValidateSpecForRelease to fail for development spec")
	}
	if !strings.Contains(err.Error(), `spec with environment "development" cannot be published`) {
		t.Errorf("unexpected release validation error: %v", err)
	}
}

// 9. isolation を省略した spec がスキーマ/パース検証で落ちる
func TestSpecWithoutIsolationFails(t *testing.T) {
	rawSpec := `{
		"slotCount": 4,
		"backend": {
			"name": "cursor",
			"model": "composer-2.5"
		},
		"discord": { "showThinking": false, "streaming": false, "completionNotify": "off" },
		"pins": {
			"cursorAgent": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"xangi": { "repo": "r", "ref": "0000000000000000000000000000000000000000" },
			"gws": { "version": "v1", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"gdgCli": { "version": "v1", "assetTemplate": "t", "sha256": { "x86_64": "0000000000000000000000000000000000000000000000000000000000000000", "aarch64": "0000000000000000000000000000000000000000000000000000000000000000" } },
			"node": { "major": 22, "minMinor": 18 }
		},
		"paths": { "agentRoot": "/opt/gdg-agent", "workspace": "/srv/gdg-agent/wiki", "runRoot": "/run/gdg-agent" }
	}`
	_, err := parseSpecBytes([]byte(rawSpec), "test-spec")
	if err == nil {
		t.Fatalf("expected parseSpecBytes to fail when isolation is omitted")
	}
}

// 10. slotLauncher: true のとき sudoers に spawn-slot-N の行が必須
func TestSudoersSlotLauncherValidation(t *testing.T) {
	validSudoers := `gdgagent-svc ALL=(gdgagent-run-0) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-0
gdgagent-svc ALL=(gdgagent-run-1) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-1
gdgagent-svc ALL=(ALL) NOPASSWD: /usr/bin/pkill -KILL -u gdgagent-run-0
gdgagent-svc ALL=(ALL) NOPASSWD: /usr/bin/pkill -KILL -u gdgagent-run-1
`
	if err := ValidateSudoersSlotLauncher(validSudoers, 2); err != nil {
		t.Fatalf("expected valid sudoers to pass, got: %v", err)
	}

	// Missing spawn-slot-1
	missingSlot := `gdgagent-svc ALL=(gdgagent-run-0) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-0
`
	if err := ValidateSudoersSlotLauncher(missingSlot, 2); err == nil {
		t.Fatalf("expected sudoers validation to fail when spawn-slot-1 is missing")
	}

	// Commented out rule must not satisfy slot requirement
	commentedSlot := `gdgagent-svc ALL=(gdgagent-run-0) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-0
# gdgagent-svc ALL=(gdgagent-run-1) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-1
`
	if err := ValidateSudoersSlotLauncher(commentedSlot, 2); err == nil {
		t.Fatalf("expected sudoers validation to fail when slot 1 is in a comment")
	}

	// Partial match must not satisfy slot 1 requirement (e.g. slot 10 must not match slot 1)
	partialMatchSlot := `gdgagent-svc ALL=(gdgagent-run-0) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-0
gdgagent-svc ALL=(gdgagent-run-10) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-10
`
	if err := ValidateSudoersSlotLauncher(partialMatchSlot, 2); err == nil {
		t.Fatalf("expected sudoers validation to fail when slot 10 is supplied instead of slot 1")
	}

	// Wildcards forbidden
	wildcardSudoers := `gdgagent-svc ALL=(gdgagent-run-0) NOPASSWD: /opt/gdg-agent/bin/spawn-slot-*
`
	if err := ValidateSudoersSlotLauncher(wildcardSudoers, 2); err == nil {
		t.Fatalf("expected sudoers validation to fail when wildcard is present")
	}
}

// 11. Bundle invariants: hooks.preToolUse[0].failClosed, sandbox mode/readBoundary, additionalReadonlyPaths
func TestCursorBundleInvariants(t *testing.T) {
	iso := IsolationSpec{
		SlotLauncher: true,
		OSSandbox:    "workspace",
		ToolGate:     "preToolUse-failClosed",
	}
	if err := ValidateBackendBundleInvariants("cursor", iso); err != nil {
		t.Fatalf("expected cursor bundle to satisfy all invariants, got: %v", err)
	}
}

// This is the deterministic half of the Antigravity E2E chain: read the command from the
// shipped hooks.json, preserve its environment selector and argv, invoke the real acl-gate.ts
// with agy's documented payload shape, and prove a non-wk/gws command receives a hard deny.
// The separate pinned-agy E2E still has to prove the CLI itself honors that decision.
func TestAntigravityShippedHookDeniesDisallowedCommand(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not available")
	}

	hooksBytes, err := backendConfigBytes("antigravity", "hooks.json")
	if err != nil {
		t.Fatal(err)
	}
	var hooks antigravityHooksFile
	if err := json.Unmarshal(hooksBytes, &hooks); err != nil {
		t.Fatalf("parse shipped antigravity hooks.json: %v", err)
	}

	var hookCommand string
	for _, group := range hooks {
		for _, event := range group.PreToolUse {
			if event.Matcher != "*" {
				continue
			}
			for _, hook := range event.Hooks {
				if strings.Contains(hook.Command, "acl-gate.ts") {
					hookCommand = hook.Command
					break
				}
			}
		}
	}
	if hookCommand == "" {
		t.Fatal("shipped antigravity hooks.json has no catch-all acl-gate.ts command")
	}

	fields := strings.Fields(hookCommand)
	var hookEnv []string
	for len(fields) > 0 && strings.Contains(fields[0], "=") {
		hookEnv = append(hookEnv, fields[0])
		fields = fields[1:]
	}
	if len(fields) < 2 {
		t.Fatalf("invalid shipped hook command %q", hookCommand)
	}
	nodePath, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	gatePath, err := filepath.Abs(filepath.Join("..", "wiki", "hooks", "acl-gate.ts"))
	if err != nil {
		t.Fatal(err)
	}
	fields[0] = nodePath
	fields[1] = gatePath

	payload, err := json.Marshal(map[string]any{
		"toolCall": map[string]any{
			"name": "run_command",
			"args": map[string]any{"CommandLine": "cat /etc/passwd"},
		},
		"cwd": t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(fields[0], fields[1:]...)
	cmd.Env = append(os.Environ(), hookEnv...)
	cmd.Stdin = bytes.NewReader(payload)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if err != nil {
		t.Fatalf("shipped antigravity hook command failed: %v\nstdout=%s\nstderr=%s", err, stdout.Bytes(), stderr.Bytes())
	}
	var decision struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &decision); err != nil {
		t.Fatalf("hook output is not decision JSON: %v\nstdout=%s\nstderr=%s", err, stdout.Bytes(), stderr.Bytes())
	}
	if decision.Decision != "deny" || !strings.Contains(decision.Reason, "wk") {
		t.Fatalf("expected hard deny from shipped hook chain, got %s", stdout.Bytes())
	}
}

func TestAntigravityBundleInvariants(t *testing.T) {
	iso := IsolationSpec{
		SlotLauncher: true,
		OSSandbox:    "none",
		ToolGate:     "preToolUse-failClosed",
	}
	if err := ValidateBackendBundleInvariants("antigravity", iso); err != nil {
		t.Fatalf("expected antigravity bundle to satisfy all invariants, got: %v", err)
	}
}

// Review finding (P1): a bundle invariant check must fail if the deployed hooks.json is
// tampered with such that it stops selecting Antigravity's decision:"deny"/"allow" wire format
// — otherwise the capability registry could keep advertising a working gate after an edit
// silently broke it. writeAntigravityBundle lets these tests substitute a broken hooks.json or
// settings.json for the real one via withConfigOverrideRoot.
func writeAntigravityBundle(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	bundleDir := filepath.Join(dir, "backends", "antigravity")
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatal(err)
	}
	defaults := map[string]string{
		"hooks.json": `{
  "acl-gate": {
    "PreToolUse": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "ACL_GATE_BACKEND=antigravity GDG_GWS_ALLOWLIST_PATH=/opt/gdg-agent/lib/antigravity-permissions.json /usr/bin/node /opt/gdg-agent/lib/acl-gate.ts /opt/gdg-agent/bin/wk /opt/gdg-agent/bin/gws", "timeout": 10}]}
    ]
  }
}`,
		"settings.json":    `{"permissions": {"allow": ["command(wk)", "command(gws)"]}}`,
		"permissions.json": `{"gwsAllowlist": []}`,
	}
	for name, content := range defaults {
		if override, ok := files[name]; ok {
			content = override
		}
		if err := os.WriteFile(filepath.Join(bundleDir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestAntigravityHooksBundleInvariantCatchesMissingBackendSelector(t *testing.T) {
	iso := IsolationSpec{SlotLauncher: true, OSSandbox: "none", ToolGate: "preToolUse-failClosed"}
	override := writeAntigravityBundle(t, map[string]string{
		// ACL_GATE_BACKEND=antigravity dropped: acl-gate.ts would silently answer in
		// Cursor's permission:deny format instead, which agy has no confirmed handling for.
		"hooks.json": `{
  "acl-gate": {
    "PreToolUse": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "node /opt/gdg-agent/lib/acl-gate.ts", "timeout": 10}]}
    ]
  }
}`,
	})
	var err error
	if wrapErr := withConfigOverrideRoot(override, func() error {
		err = ValidateBackendBundleInvariants("antigravity", iso)
		return nil
	}); wrapErr != nil {
		t.Fatal(wrapErr)
	}
	if err == nil || !strings.Contains(err.Error(), "exact Antigravity acl-gate command") {
		t.Fatalf("expected rejection citing the invalid gate command, got: %v", err)
	}
}

func TestAntigravityHooksBundleInvariantCatchesMissingTimeout(t *testing.T) {
	iso := IsolationSpec{SlotLauncher: true, OSSandbox: "none", ToolGate: "preToolUse-failClosed"}
	override := writeAntigravityBundle(t, map[string]string{
		"hooks.json": `{
  "acl-gate": {
    "PreToolUse": [
      {"matcher": "*", "hooks": [{"type": "command", "command": "ACL_GATE_BACKEND=antigravity GDG_GWS_ALLOWLIST_PATH=/opt/gdg-agent/lib/antigravity-permissions.json /usr/bin/node /opt/gdg-agent/lib/acl-gate.ts /opt/gdg-agent/bin/wk /opt/gdg-agent/bin/gws"}]}
    ]
  }
}`,
	})
	var err error
	if wrapErr := withConfigOverrideRoot(override, func() error {
		err = ValidateBackendBundleInvariants("antigravity", iso)
		return nil
	}); wrapErr != nil {
		t.Fatal(wrapErr)
	}
	if err == nil || !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("expected rejection citing the missing timeout, got: %v", err)
	}
}

func TestAntigravityHooksBundleInvariantCatchesWrongMatcher(t *testing.T) {
	iso := IsolationSpec{SlotLauncher: true, OSSandbox: "none", ToolGate: "preToolUse-failClosed"}
	override := writeAntigravityBundle(t, map[string]string{
		// A narrowed matcher would silently exempt every other tool name from the gate.
		"hooks.json": `{
  "acl-gate": {
    "PreToolUse": [
      {"matcher": "run_command", "hooks": [{"type": "command", "command": "ACL_GATE_BACKEND=antigravity GDG_GWS_ALLOWLIST_PATH=/opt/gdg-agent/lib/antigravity-permissions.json /usr/bin/node /opt/gdg-agent/lib/acl-gate.ts /opt/gdg-agent/bin/wk /opt/gdg-agent/bin/gws", "timeout": 10}]}
    ]
  }
}`,
	})
	var err error
	if wrapErr := withConfigOverrideRoot(override, func() error {
		err = ValidateBackendBundleInvariants("antigravity", iso)
		return nil
	}); wrapErr != nil {
		t.Fatal(wrapErr)
	}
	if err == nil {
		t.Fatalf("expected rejection of a hooks.json with no \"*\" matcher invoking acl-gate.ts")
	}
}

func TestAntigravitySettingsBundleInvariantCatchesMissingAllowRule(t *testing.T) {
	iso := IsolationSpec{SlotLauncher: true, OSSandbox: "none", ToolGate: "preToolUse-failClosed"}
	override := writeAntigravityBundle(t, map[string]string{
		// Without command(wk)/command(gws), headless mode auto-denies every wk/gws
		// invocation regardless of the hook's own decision:"allow" (ADR-032 E2E finding).
		"settings.json": `{"permissions": {"allow": ["command(wk)"]}}`,
	})
	var err error
	if wrapErr := withConfigOverrideRoot(override, func() error {
		err = ValidateBackendBundleInvariants("antigravity", iso)
		return nil
	}); wrapErr != nil {
		t.Fatal(wrapErr)
	}
	if err == nil || !strings.Contains(err.Error(), "command(gws)") {
		t.Fatalf("expected rejection citing the missing command(gws) allow-rule, got: %v", err)
	}
}

func TestSandboxReadonlyPathsCanonicalization(t *testing.T) {
	// Valid baseline
	validPaths := []string{
		"/opt/gdg-agent/lib",
		"/run/gdg-agent/0",
		"__RUN_SLOT_DIR__",
	}
	if err := ValidateSandboxReadonlyPaths(validPaths); err != nil {
		t.Fatalf("expected valid paths to pass, got: %v", err)
	}

	// Parent /run/gdg-agent directly
	if err := ValidateSandboxReadonlyPaths([]string{"/run/gdg-agent", "__RUN_SLOT_DIR__"}); err == nil {
		t.Fatalf("expected /run/gdg-agent to be rejected")
	}

	// Parent /run/gdg-agent with trailing dot
	if err := ValidateSandboxReadonlyPaths([]string{"/run/gdg-agent/.", "__RUN_SLOT_DIR__"}); err == nil {
		t.Fatalf("expected /run/gdg-agent/. to be rejected")
	}

	// Parent /run/gdg-agent via child traversal
	if err := ValidateSandboxReadonlyPaths([]string{"/run/gdg-agent/0/..", "__RUN_SLOT_DIR__"}); err == nil {
		t.Fatalf("expected /run/gdg-agent/0/.. to be rejected")
	}

	// Multi-level traversal to parent
	if err := ValidateSandboxReadonlyPaths([]string{"/run/gdg-agent/sub/nested/../..", "__RUN_SLOT_DIR__"}); err == nil {
		t.Fatalf("expected /run/gdg-agent/sub/nested/../.. to be rejected")
	}

	// Traversal via __RUN_SLOT_DIR__/..
	if err := ValidateSandboxReadonlyPaths([]string{"__RUN_SLOT_DIR__/.."}); err == nil {
		t.Fatalf("expected __RUN_SLOT_DIR__/.. to be rejected")
	}

	// Traversal via __RUN_SLOT_DIR__/../other
	if err := ValidateSandboxReadonlyPaths([]string{"__RUN_SLOT_DIR__/../other", "__RUN_SLOT_DIR__"}); err == nil {
		t.Fatalf("expected __RUN_SLOT_DIR__/../other to be rejected")
	}

	// Missing __RUN_SLOT_DIR__ placeholder
	if err := ValidateSandboxReadonlyPaths([]string{"/opt/gdg-agent/lib", "/usr/bin"}); err == nil {
		t.Fatalf("expected missing __RUN_SLOT_DIR__ placeholder to be rejected")
	}
}

// 12. BackendPolicy dispatch encapsulation
func TestBackendPolicyResourceDispatch(t *testing.T) {
	prefix := t.TempDir()
	spec := validProductionSpec()
	paths, err := resolveLayoutPaths(spec, prefix, 2)
	if err != nil {
		t.Fatal(err)
	}

	// Cursor policy dispatch
	cursorPol, err := GetBackendPolicy("cursor")
	if err != nil {
		t.Fatal(err)
	}
	hostRes, err := cursorPol.BuildHostResources(paths)
	if err != nil {
		t.Fatalf("cursor BuildHostResources failed: %v", err)
	}
	if len(hostRes) != 2 { // cli-config.json and apparmor.d
		t.Errorf("expected 2 host resources for cursor (cli-config and apparmor), got %d", len(hostRes))
	}

	slotDirs, err := cursorPol.BuildSlotDirectories(paths, 0)
	if err != nil {
		t.Fatalf("cursor BuildSlotDirectories failed: %v", err)
	}
	if len(slotDirs) != 2 { // .cursor and .cursor/projects
		t.Errorf("expected 2 slot dirs for cursor, got %d", len(slotDirs))
	}

	slotRes, err := cursorPol.BuildSlotResources(paths, 0, "/run/gdg-agent/0", "/run/gdg-agent/0/index.sock")
	if err != nil {
		t.Fatalf("cursor BuildSlotResources failed: %v", err)
	}
	if len(slotRes) != 5 { // hooks, cli-config, sandbox, mcp, permissions
		t.Errorf("expected 5 slot resources for cursor, got %d", len(slotRes))
	}

	// Antigravity policy dispatch. Stage 14 (ADR-032) implemented the toolGate layer as a
	// root-owned per-slot ~/.gemini/config/hooks.json (mirroring Cursor's ~/.cursor/ pattern,
	// after a code-review finding that Tier-1 workspace-synced content is group-writable by
	// every gdgagent-run-* slot user and so cannot constrain them). BuildHostResources/
	// BuildSlotDirectories/BuildSlotResources are keyed off the spec's requested isolation
	// (validProductionSpec() always requests the full 3 layers, regardless of backend.name),
	// not the capability registry — GetBackendCapabilities("antigravity").ToolGate stays
	// "none" until a pinned+checksummed agy version passes an E2E deny test, but these
	// resource builders are exercised here independently of that gate.
	agPol, err := GetBackendPolicy("antigravity")
	if err != nil {
		t.Fatal(err)
	}
	agHostRes, err := agPol.BuildHostResources(paths)
	if err != nil || len(agHostRes) != 1 { // antigravity-permissions.json
		t.Errorf("expected 1 host resource for antigravity after Stage 14, got %d (err: %v)", len(agHostRes), err)
	}
	agSlotDirs, err := agPol.BuildSlotDirectories(paths, 0)
	if err != nil || len(agSlotDirs) != 3 { // .gemini, .gemini/config, .gemini/antigravity-cli
		t.Errorf("expected 3 slot dirs for antigravity after Stage 14, got %d (err: %v)", len(agSlotDirs), err)
	}
	agSlotRes, err := agPol.BuildSlotResources(paths, 0, "/run/gdg-agent/0", "/run/gdg-agent/0/index.sock")
	if err != nil || len(agSlotRes) != 2 { // hooks.json, settings.json
		t.Errorf("expected 2 slot resources for antigravity after Stage 14, got %d (err: %v)", len(agSlotRes), err)
	}

	customPaths := paths
	customPaths.SpecAgentRoot = "/opt/custom-agent"
	customSlotRes, err := agPol.BuildSlotResources(
		customPaths,
		0,
		"/run/custom-agent/0",
		"/run/custom-agent/0/index.sock",
	)
	if err != nil {
		t.Fatal(err)
	}
	hooksResource, ok := customSlotRes[0].(*FileResource)
	if !ok {
		t.Fatalf("expected first antigravity slot resource to be hooks.json, got %T", customSlotRes[0])
	}
	if !strings.Contains(string(hooksResource.Data), "/opt/custom-agent/lib/acl-gate.ts") ||
		strings.Contains(string(hooksResource.Data), "/opt/gdg-agent/") {
		t.Fatalf("antigravity hooks.json must honor paths.agentRoot, got:\n%s", hooksResource.Data)
	}
}
