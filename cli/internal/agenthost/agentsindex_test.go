package agenthost

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki"
)

// planFor builds a plan against a fresh prefix at the given slot count.
func planFor(t *testing.T, prefix string, slotCount int) *Plan {
	t.Helper()
	plan, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath:  defaultSpec(t),
		Prefix:    prefix,
		SlotCount: slotCount,
	})
	if err != nil {
		t.Fatalf("BuildPlan(slotCount=%d): %v", slotCount, err)
	}
	return plan
}

func agentsIndexUnitData(t *testing.T, plan *Plan) string {
	t.Helper()
	for _, r := range plan.Resources {
		s, ok := r.(*SystemdUnitResource)
		if ok && s.UnitName == "agents-index.service" {
			return string(s.Data)
		}
	}
	t.Fatal("agents-index.service not found in plan")
	return ""
}

// The old install.sh carried a literal `--slots 4`. Deriving it from
// spec.slotCount is the whole point of folding agents-index into the spec:
// changing slotCount must move --slots and SupplementaryGroups together.
func TestAgentsIndexSlotCountDerivesUnit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	for _, slotCount := range []int{2, 4, 7} {
		unit := agentsIndexUnitData(t, planFor(t, t.TempDir(), slotCount))

		wantSlots := "--slots " + strconv.Itoa(slotCount) + " "
		if !strings.Contains(unit, wantSlots) {
			t.Errorf("slotCount=%d: unit ExecStart missing %q:\n%s", slotCount, wantSlots, unit)
		}

		lastSlotGroup := "gdgagent-run-" + strconv.Itoa(slotCount-1)
		if !strings.Contains(unit, "SupplementaryGroups=gdgwiki ") {
			t.Errorf("slotCount=%d: unit missing SupplementaryGroups prefix:\n%s", slotCount, unit)
		}
		if !strings.Contains(unit, lastSlotGroup) {
			t.Errorf("slotCount=%d: SupplementaryGroups missing %q:\n%s", slotCount, lastSlotGroup, unit)
		}
		if strings.Contains(unit, "gdgagent-run-"+strconv.Itoa(slotCount)) {
			t.Errorf("slotCount=%d: SupplementaryGroups references a slot beyond the count:\n%s", slotCount, unit)
		}
	}
}

// If agents-index.service ever ExecStarts from the install-time checkout, Stage
// 13 removing /opt/gdgjp silently stops wiki search. --dry-run --diff cannot
// catch that, so pin it here.
func TestAgentsIndexUnitHasNoOptGdgjp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	unit := agentsIndexUnitData(t, planFor(t, t.TempDir(), 4))
	if strings.Contains(unit, "/opt/gdgjp") {
		t.Fatalf("agents-index.service must not reference /opt/gdgjp:\n%s", unit)
	}
	if !strings.Contains(unit, "ExecStart=/usr/bin/node /opt/agents-index/src/cli.ts watch") {
		t.Fatalf("agents-index.service must ExecStart from /opt/agents-index:\n%s", unit)
	}
}

// The old design had an implicit ordering ("run agents-local/install.sh first")
// enforced by hard-fails. Folded in, every agents-index resource must be present
// in the single plan the caller assembles, with no separate entrypoint.
func TestAgentsIndexResourcesInSinglePlan(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	plan := planFor(t, t.TempDir(), 4)

	wantDir := map[string]bool{
		"/var/lib/agents-index":     false,
		"/var/lib/agents-index/hf":  false,
		"/opt/agents-index":         false,
		"/opt/agents-index/src":     false,
		"/opt/agents-index/src/acl": false,
	}
	wantFile := map[string]bool{
		"/opt/agents-index/package.json":      false,
		"/opt/agents-index/package-lock.json": false,
		"/opt/agents-index/src/cli.ts":        false,
		"/opt/agents-index/src/acl/agent.ts":  false,
		"/opt/gdg-agent/bin/agents-index":     false,
	}
	var haveExec, haveUnit bool

	prefix := plan.Paths.Prefix
	for _, r := range plan.Resources {
		switch res := r.(type) {
		case *DirResource:
			if k := strings.TrimPrefix(res.Path, prefix); wantDirHas(wantDir, k) {
				wantDir[k] = true
			}
		case *FileResource:
			if k := strings.TrimPrefix(res.Path, prefix); wantFileHas(wantFile, k) {
				wantFile[k] = true
			}
		case *ExecResource:
			if res.Name == "npm-ci:/opt/agents-index" {
				haveExec = true
			}
		case *SystemdUnitResource:
			if res.UnitName == "agents-index.service" {
				haveUnit = true
			}
		}
	}

	for k, ok := range wantDir {
		if !ok {
			t.Errorf("plan missing agents-index dir %s", k)
		}
	}
	for k, ok := range wantFile {
		if !ok {
			t.Errorf("plan missing agents-index file %s", k)
		}
	}
	if !haveExec {
		t.Error("plan missing npm-ci:/opt/agents-index exec resource")
	}
	if !haveUnit {
		t.Error("plan missing agents-index.service systemd resource")
	}
}

func TestAgentsIndexACLImportRewrite(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	if err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}

	cases := map[string]string{
		"opt/agents-index/src/authz.ts":           `from "./acl/agent.ts"`,
		"opt/agents-index/src/acl/filter.ts":      `from "./agent.ts"`,
		"opt/agents-index/src/acl/frontmatter.ts": `from "./agent.ts"`,
	}
	for rel, want := range cases {
		body, err := os.ReadFile(filepath.Join(prefix, rel))
		if err != nil {
			t.Fatalf("read %s: %v", rel, err)
		}
		if strings.Contains(string(body), "@gdgjp/gdg-lib") {
			t.Errorf("%s still imports @gdgjp/gdg-lib:\n%s", rel, body)
		}
		if !strings.Contains(string(body), want) {
			t.Errorf("%s missing rewritten import %q", rel, want)
		}
	}

	vendored, err := os.ReadFile(filepath.Join(prefix, "opt/agents-index/src/acl/agent.ts"))
	if err != nil {
		t.Fatalf("vendored acl bundle not emitted: %v", err)
	}
	if string(vendored) != string(wiki.AgentLibFiles()["acl.ts"]) {
		t.Error("vendored /opt/agents-index/src/acl/agent.ts differs from the shared acl.ts bundle")
	}
}

// Removing /opt/gdgjp must not touch agents-index: its files come from
// /opt/agents-index and the embedded CLI, so a second apply after the deploy
// tree exists is a no-op for every agents-index resource.
func TestAgentsIndexApplyIdempotent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	opts := PlanOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}

	first, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), first, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	second, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range second.Resources {
		if !isAgentsIndexResource(r, prefix) {
			continue
		}
		if second.Changes[i].Action != ActionNone {
			t.Errorf("agents-index resource %s (%s) not converged on 2nd apply: %s",
				r.ID(), r.ResourceType(), second.Changes[i].Diff)
		}
	}
}

// A new gdg binary carrying updated /opt/agents-index sources or a new ACL
// bundle must restart the daemon, not leave an old Node process on new-on-disk
// code. The unit carries an artifacts-rev line so its content flips on any
// deployed-code change, which SystemdUnitResource already turns into a restart.
func TestAgentsIndexUnitRestartsOnDeployedCodeChange(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	opts := PlanOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}

	plan, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), plan, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	unitPath := filepath.Join(prefix, "etc/systemd/system/agents-index.service")
	onDisk, err := os.ReadFile(unitPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(onDisk), "# gdg-artifacts-rev: ") {
		t.Fatalf("agents-index.service missing artifacts-rev marker:\n%s", onDisk)
	}

	// Simulate an older deploy: same unit, stale rev. A re-plan must want to
	// rewrite it (which, live, triggers daemon-reload + restart).
	stale := regexpReplaceRev(string(onDisk), "0000000000000000")
	if stale == string(onDisk) {
		t.Fatal("failed to mutate rev for the stale-unit simulation")
	}
	if err := os.WriteFile(unitPath, []byte(stale), 0o644); err != nil {
		t.Fatal(err)
	}

	replan, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for i, r := range replan.Resources {
		if s, ok := r.(*SystemdUnitResource); ok && s.UnitName == "agents-index.service" {
			found = true
			if replan.Changes[i].Action != ActionUpdate {
				t.Fatalf("stale-rev unit should replan as update, got %s", replan.Changes[i].Action)
			}
		}
	}
	if !found {
		t.Fatal("agents-index.service not in replan")
	}
}

func TestAgentsIndexArtifactsRevIsStableAndContentSensitive(t *testing.T) {
	a := []deployedArtifact{{rel: "src/b.ts", data: []byte("2")}, {rel: "src/a.ts", data: []byte("1")}}
	b := []deployedArtifact{{rel: "src/a.ts", data: []byte("1")}, {rel: "src/b.ts", data: []byte("2")}}
	if agentsIndexArtifactsRev(a) != agentsIndexArtifactsRev(b) {
		t.Error("rev must be independent of input order")
	}
	c := []deployedArtifact{{rel: "src/a.ts", data: []byte("1")}, {rel: "src/b.ts", data: []byte("2x")}}
	if agentsIndexArtifactsRev(a) == agentsIndexArtifactsRev(c) {
		t.Error("rev must change when any deployed byte changes")
	}
}

// agentsIndex.enabled=false must actively tear down a previously enabled install:
// stop/disable/remove the unit and delete /opt/agents-index, while leaving the
// persistent data directory intact.
func TestAgentsIndexDisabledTearsDown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()

	// 1. Converge enabled.
	if err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(prefix, "opt/gdg-agent/bin/agents-index")
	deployRoot := filepath.Join(prefix, "opt/agents-index")
	unitPath := filepath.Join(prefix, "etc/systemd/system/agents-index.service")
	dataDir := filepath.Join(prefix, "var/lib/agents-index")
	for _, p := range []string{launcher, deployRoot, unitPath, dataDir} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("expected %s after enabled converge: %v", p, err)
		}
	}

	// 2. Re-converge with an overlay that disables it.
	overlay := filepath.Join(t.TempDir(), "disable.json")
	if err := os.WriteFile(overlay, []byte(`{"agentsIndex":{"enabled":false}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := EmitLayout(EmitOptions{SpecPath: defaultSpec(t), OverlayPath: overlay, Prefix: prefix, SlotCount: 4}); err != nil {
		t.Fatal(err)
	}

	for _, p := range []string{launcher, deployRoot, unitPath} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("expected %s removed when disabled, got err=%v", p, err)
		}
	}
	if _, err := os.Stat(dataDir); err != nil {
		t.Errorf("persistent data dir must survive a disable: %v", err)
	}

	// 3. Idempotent: a second disabled converge is a no-op.
	plan, err := BuildPlan(context.Background(), PlanOptions{
		SpecPath: defaultSpec(t), OverlayPath: overlay, Prefix: prefix, SlotCount: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range plan.Resources {
		if isAgentsIndexResource(r, prefix) && plan.Changes[i].Action != ActionNone {
			t.Errorf("disabled agents-index resource %s still pending: %s", r.ID(), plan.Changes[i].Diff)
		}
	}
}

// ApplyPlan Phase 3 must re-plan systemd resources against live state, the way
// Phase 2 re-plans exec resources, so a unit that npm ci (Phase 2) just made
// startable does not need a whole extra apply to converge.
func TestApplyPlanRePlansSystemdAfterExec(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("layout emit requires visudo")
	}
	prefix := t.TempDir()
	opts := PlanOptions{SpecPath: defaultSpec(t), Prefix: prefix, SlotCount: 4}

	first, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyPlan(context.Background(), first, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}

	// A converged plan: every systemd change is ActionNone.
	converged, err := BuildPlan(context.Background(), opts)
	if err != nil {
		t.Fatal(err)
	}
	unitPath := filepath.Join(prefix, "etc/systemd/system/agents-index.service")
	for i, r := range converged.Resources {
		if s, ok := r.(*SystemdUnitResource); ok && s.UnitName == "agents-index.service" {
			if converged.Changes[i].Action != ActionNone {
				t.Fatalf("expected converged agents-index.service, got %s", converged.Changes[i].Action)
			}
		}
	}

	// Something removes the unit out of band after the stale plan was built.
	if err := os.Remove(unitPath); err != nil {
		t.Fatal(err)
	}

	// Applying the stale plan must still restore it, because Phase 3 re-plans.
	if err := ApplyPlan(context.Background(), converged, ApplyOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(unitPath); err != nil {
		t.Fatalf("Phase 3 did not re-plan the systemd resource; unit not restored: %v", err)
	}
}

// The deployed daemon is executed as raw .ts by Node's strip-only loader, so the
// embedded sources must stay erasable. This is the cheap guard that runs without
// Node; the mjs suite additionally loads each rendered file.
func TestAgentsIndexSourcesAreErasable(t *testing.T) {
	nonErasable := []*regexp.Regexp{
		regexp.MustCompile(`constructor\s*\([^)]*\b(private|public|protected|readonly)\b`),
		regexp.MustCompile(`(?m)^\s*(export\s+)?(declare\s+)?namespace\s+\w`),
		regexp.MustCompile(`(?m)^\s*(export\s+)?(const\s+)?enum\s+\w`),
		regexp.MustCompile(`import\s+\w+\s*=\s*require\(`),
	}
	err := fs.WalkDir(agentsIndexFS, "assets/agents-index/src", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() || !strings.HasSuffix(path, ".ts") {
			return walkErr
		}
		body, readErr := agentsIndexFS.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		src := stripBlockComments(string(body))
		for _, re := range nonErasable {
			if re.MatchString(src) {
				t.Errorf("%s: non-erasable TypeScript %q — the deployed daemon runs this through Node's strip-only loader", path, re.String())
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func stripBlockComments(s string) string {
	for {
		i := strings.Index(s, "/*")
		if i < 0 {
			return s
		}
		j := strings.Index(s[i:], "*/")
		if j < 0 {
			return s[:i]
		}
		s = s[:i] + s[i+j+2:]
	}
}

func TestIsMissingUnitError(t *testing.T) {
	for _, msg := range []string{
		"systemctl disable failed: exit status 1 (Failed to disable unit: Unit file agents-index.service does not exist.)",
		"Unit agents-index.service not loaded.",
	} {
		if !isMissingUnitError(errString(msg)) {
			t.Errorf("expected %q to classify as a missing-unit error", msg)
		}
	}
	if isMissingUnitError(errString("Job for agents-index.service failed because the control process exited")) {
		t.Error("a real start failure must not be treated as missing-unit")
	}
}

type errString string

func (e errString) Error() string { return string(e) }

func regexpReplaceRev(unit, rev string) string {
	const marker = "# gdg-artifacts-rev: "
	i := strings.Index(unit, marker)
	if i < 0 {
		return unit
	}
	j := strings.IndexByte(unit[i:], '\n')
	if j < 0 {
		return unit
	}
	return unit[:i+len(marker)] + rev + unit[i+j:]
}

func isAgentsIndexResource(r Resource, prefix string) bool {
	id := strings.TrimPrefix(r.ID(), prefix)
	return strings.Contains(id, "agents-index") ||
		strings.HasPrefix(id, "/opt/agents-index") ||
		id == "agents-index.service"
}

func wantDirHas(m map[string]bool, k string) bool  { _, ok := m[k]; return ok }
func wantFileHas(m map[string]bool, k string) bool { _, ok := m[k]; return ok }
