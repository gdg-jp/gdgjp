import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  STATE_MACHINE_MODULES,
  SUMMARY_JSON,
  SUMMARY_MARKDOWN,
  buildSummary,
  cell,
  classifyChangedFiles,
  collectEvidence,
  evidenceRequirements,
  journeyOwners,
  main,
  parseArguments,
  renderMarkdown,
  verifierCoverage,
} from "../../scripts/verification-summary.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "gdg-verification-summary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value, time) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    if (time) utimesSync(file, new Date(time), new Date(time));
    return file;
  };
  return { root, put };
}

function seedCoverage(put) {
  put(".agents/skills/verify-accounts-client-revocation/coverage.json", {
    sources: {
      "apps/accounts/app/features/developer-apps/oauth-clients.server.ts": "hash",
      "apps/accounts/app/features/auth/auth.server.ts": "hash",
    },
  });
  put(".agents/skills/verify-acl-boundaries/coverage.json", {
    sources: ["packages/gdg-lib/src/acl/core.ts"],
  });
  put(".agents/skills/verify-job-lifecycle/coverage.json", {
    sources: [
      { path: "apps/wiki/app/features/jobs/lease.server.ts", role: "production" },
      { path: "apps/cli/go.mod", role: "tool-config" },
    ],
  });
}

function seedEvidence(put) {
  put(".turbo/ci-metrics/2000-1.json", {
    schemaVersion: 1,
    mode: "quick",
    startedAtUnixMs: Date.parse("2026-11-20T00:00:00Z"),
    steps: [
      { name: "lint", exitCode: 0, durationMs: 4000, turboRuns: [] },
      {
        name: "test",
        exitCode: 0,
        durationMs: 9000,
        turboRuns: [{ tasks: [{ taskId: "a#test", cache: "HIT" }] }],
      },
      { name: "typecheck", exitCode: 1, durationMs: 2000 },
    ],
    skippedSteps: ["e2e"],
  });
  put(".turbo/ci-metrics/1000-1.json", {
    schemaVersion: 1,
    mode: "full",
    startedAtUnixMs: Date.parse("2026-11-19T00:00:00Z"),
    steps: [{ name: "old", exitCode: 0 }],
  });
  put(
    "local_data/pstack/e2e/run-1/result.json",
    {
      status: "VERIFIED",
      selected: ["@gdgjp/wiki"],
      reports: [
        { workspace: "apps/wiki", counts: { passed: 12, failed: 0, skipped: 1, flaky: 0 } },
      ],
      scratchCleaned: true,
    },
    "2026-11-20T01:00:00Z",
  );
  put("local_data/pstack/e2e/run-1/apps/wiki/test-results/home/shot.png", "png");
  put("local_data/pstack/e2e/run-1/apps/wiki/test-results/storage-state/admin.png", "secret");
  put("local_data/pstack/e2e/run-1/apps/wiki/playwright-report/data/copy.png", "duplicate");
  put("local_data/pstack/job-lifecycle/run-2/result.json", {
    kind: "job-lifecycle-verification",
    status: "STALE",
    mutationProof: true,
    mutations: [],
    completedAt: "2026-11-20T02:00:00Z",
  });
  put(
    "local_data/pstack/accounts-client-revocation/2026-11-20.json",
    {
      verification: "accounts-client-revocation",
      tool: "Alloy 6.2.0",
      exitCode: 0,
      checks: [{}, {}],
      mutations: [{ detected: true }, { detected: true }],
      openFindings: ["F1"],
    },
    "2026-11-20T03:00:00Z",
  );
  put("local_data/pstack/platform/run-3/journeys.json", [
    {
      id: "accounts-sign-in",
      status: "VERIFIED",
      observedAt: "2026-11-20T04:00:00Z",
      entryPoint: "/",
    },
    {
      id: "wiki-search",
      status: "FAILED",
      observedAt: "2026-11-20T04:01:00Z",
      failure: "no results",
    },
  ]);
  put("local_data/pstack/platform/run-3/journey.webm", "webm");
}

test("changed files are classified from verifier coverage and path patterns", (t) => {
  const { root, put } = fixture(t);
  seedCoverage(put);
  const changes = classifyChangedFiles(
    [
      "apps/wiki/app/routes/home.tsx",
      "apps/wiki/app/routes/home.test.tsx",
      "apps/wiki/tests/e2e/home.spec.ts",
      "apps/wiki/app/locales/ja/common.json",
      "apps/accounts/app/features/developer-apps/oauth-clients.server.ts",
      "apps/accounts/app/features/auth/auth.server.ts",
      "packages/gdg-lib/src/acl/core.ts",
      "apps/wiki/app/features/jobs/lease.server.ts",
      "apps/cli/go.mod",
      ".agents/skills/verify-accounts-client-revocation/model/revocation.als",
      "docs/engineering/ai-review.md",
    ],
    verifierCoverage(root),
  );
  assert.deepEqual(changes.ui, [
    "apps/wiki/app/locales/ja/common.json",
    "apps/wiki/app/routes/home.tsx",
  ]);
  assert.deepEqual(changes.stateMachine, [
    ".agents/skills/verify-accounts-client-revocation/model/revocation.als",
    "apps/accounts/app/features/auth/auth.server.ts",
    "apps/accounts/app/features/developer-apps/oauth-clients.server.ts",
    "apps/wiki/app/features/jobs/lease.server.ts",
  ]);
  assert.deepEqual(changes.verifiers, {
    "accounts-client-revocation": [
      ".agents/skills/verify-accounts-client-revocation/model/revocation.als",
      "apps/accounts/app/features/auth/auth.server.ts",
      "apps/accounts/app/features/developer-apps/oauth-clients.server.ts",
    ],
    "acl-boundaries": ["packages/gdg-lib/src/acl/core.ts"],
    "job-lifecycle": ["apps/wiki/app/features/jobs/lease.server.ts"],
  });
});

test("local evidence is summarized from what ran, newest per check, without secrets", (t) => {
  const { root, put } = fixture(t);
  seedEvidence(put);
  const { entries, media } = collectEvidence({
    roots: [
      { label: "ci-metrics", path: join(root, ".turbo/ci-metrics") },
      { label: "pstack", path: join(root, "local_data/pstack") },
    ],
  });
  const by = (source) => entries.filter((entry) => entry.source === source);
  assert.deepEqual(
    by("ci-metrics").map(({ name, status }) => [name, status]),
    [
      ["lint", "VERIFIED"],
      ["test", "VERIFIED"],
      ["typecheck", "NOT VERIFIED"],
      ["e2e", "NOT VERIFIED"],
    ],
  );
  assert.match(by("ci-metrics")[1].details, /cached result/);
  assert.match(by("ci-metrics")[3].details, /skipped/);
  assert.equal(by("isolated-e2e")[0].status, "VERIFIED");
  assert.match(by("isolated-e2e")[0].details, /apps\/wiki: 12 passed, 0 failed/);
  assert.equal(by("job-lifecycle")[0].status, "INCONCLUSIVE");
  assert.equal(by("accounts-client-revocation")[0].status, "VERIFIED");
  assert.match(by("accounts-client-revocation")[0].details, /open findings F1/);
  assert.deepEqual(
    by("orca-journeys").map(({ name, status }) => [name, status]),
    [
      ["platform/accounts-sign-in", "VERIFIED"],
      ["platform/wiki-search", "NOT VERIFIED"],
    ],
  );
  assert.ok(by("orca-journeys").every((entry) => entry.workspaces.length === 0));
  assert.deepEqual(by("isolated-e2e")[0].workspaces, ["apps/wiki"]);
  assert.deepEqual(
    media.map(({ path, kind, workspace }) => [path, kind, workspace]),
    [
      ["pstack/e2e/run-1/apps/wiki/test-results/home/shot.png", "screenshot", "apps/wiki"],
      ["pstack/platform/run-3/journey.webm", "recording", null],
    ],
  );
});

function seedAttributedEvidence(put) {
  put(".agents/skills/verify-apps/coverage.json", {
    journeys: [
      { id: "deck-access", app: "deck" },
      { id: "mc-timer", app: "mc" },
    ],
  });
  put("local_data/pstack/pay/r1/run.json", { applications: { pay: {} } });
  put("local_data/pstack/pay/r1/screenshots/receipt.png", "png");
  put("local_data/pstack/pay/r1/journeys.json", {
    journeys: [{ id: "pay-receipt", status: "VERIFIED", observedAt: "2026-11-20T00:00:00Z" }],
  });
  put("local_data/pstack/apps/r2/run.json", { applications: { mc: {}, deck: {} } });
  put("local_data/pstack/apps/r2/orca-mc/timer.png", "png");
  put("local_data/pstack/apps/r2/orca/shared.png", "png");
  put("local_data/pstack/apps/r2/journeys.json", {
    journeys: [
      { id: "deck-access", status: "VERIFIED", observedAt: "2026-11-20T00:00:00Z" },
      { id: "wiki-claim", app: "wiki", status: "VERIFIED", observedAt: "2026-11-20T00:00:00Z" },
      { id: "unmapped", status: "VERIFIED", observedAt: "2026-11-20T00:00:00Z" },
    ],
  });
  put("local_data/pstack/platform/r3/run.json", {
    origins: { accounts: "http://localhost:6173", wiki: "http://localhost:6177" },
  });
  put("local_data/pstack/platform/r3/orca-wiki-runner/translated.png", "png");
  put("local_data/pstack/wiki/r4/page.png", "png");
  put("local_data/pstack/e2e/r5/packages/design-system/test-results/form/shot.png", "png");
  put("local_data/pstack/stray.png", "png");
  put("inputs/design-harness-reports/catalog.png", "png");
}

function collectAttributed(root) {
  return collectEvidence({
    roots: [
      { label: "pstack", path: join(root, "local_data/pstack") },
      { label: "inputs", path: join(root, "inputs") },
    ],
    owners: journeyOwners(root),
  });
}

test("evidence is attributed from where it was produced, and the rest stays unattributed", (t) => {
  const { root, put } = fixture(t);
  seedAttributedEvidence(put);
  const { entries, media } = collectAttributed(root);
  assert.deepEqual(
    media.map(({ path, workspace }) => [path, workspace]),
    [
      ["inputs/design-harness-reports/catalog.png", "packages/design-system"],
      ["pstack/apps/r2/orca-mc/timer.png", "apps/mc"],
      ["pstack/apps/r2/orca/shared.png", null],
      ["pstack/e2e/r5/packages/design-system/test-results/form/shot.png", "packages/design-system"],
      ["pstack/pay/r1/screenshots/receipt.png", "apps/pay"],
      ["pstack/platform/r3/orca-wiki-runner/translated.png", "apps/wiki"],
      ["pstack/stray.png", null],
      ["pstack/wiki/r4/page.png", "apps/wiki"],
    ],
  );
  assert.deepEqual(
    entries
      .filter((entry) => entry.source === "orca-journeys")
      .map(({ name, workspaces }) => [name, workspaces]),
    [
      ["apps/deck-access", ["apps/deck"]],
      ["apps/wiki-claim", []],
      ["apps/unmapped", []],
      ["pay/pay-receipt", ["apps/pay"]],
    ],
  );
});

test("another app's screenshot or Orca journey does not satisfy a UI change", (t) => {
  const { root, put } = fixture(t);
  seedAttributedEvidence(put);
  const { entries, media } = collectAttributed(root);
  const build = (changedFiles) =>
    buildSummary({
      commit: "abc",
      context: "local",
      changedFiles,
      coverage: new Map(),
      entries,
      media,
    }).summary;
  const wiki = build(["apps/wiki/app/components/Navbar.tsx"]);
  assert.deepEqual(wiki.requirements, [
    {
      id: "ui:apps/wiki",
      kind: "ui",
      workspace: "apps/wiki",
      paths: ["apps/wiki/app/components/Navbar.tsx"],
      label:
        "Screenshots or recordings of the changed apps/wiki screens, or a VERIFIED Orca journey of apps/wiki",
      satisfied: true,
      evidence: [
        "media/pstack/platform/r3/orca-wiki-runner/translated.png",
        "media/pstack/wiki/r4/page.png",
      ],
    },
  ]);
  assert.deepEqual(wiki.unattributed, {
    media: ["media/pstack/apps/r2/orca/shared.png", "media/pstack/stray.png"],
    journeys: ["apps/wiki-claim", "apps/unmapped"],
  });
  const markdown = renderMarkdown(wiki);
  assert.match(markdown, /### Unattributed evidence/);
  assert.match(markdown, /- screenshot of apps\/pay: `media\/pstack\/pay\/r1/);
  const deck = build(["apps/deck/app/routes/edit.tsx"]);
  assert.deepEqual(deck.requirements[0].evidence, ["apps/deck-access"]);
  assert.equal(deck.requirements[0].satisfied, true);
  const roster = build(["apps/roster/app/routes/home.tsx"]);
  assert.equal(roster.requirements[0].satisfied, false);
});

test("UI requirements are matched per app and per package by the stated rule", () => {
  const changes = classifyChangedFiles([
    "apps/wiki/app/components/Navbar.tsx",
    "apps/pay/app/routes/receipt.tsx",
    "packages/design-system/src/components/button.tsx",
    "packages/gdg-lib/src/ui/menu.tsx",
  ]);
  const satisfied = (summary) =>
    evidenceRequirements(changes, summary).map(({ id, satisfied }) => [id, satisfied]);
  const payOnly = {
    media: [{ path: "media/pay/receipt.png", workspace: "apps/pay" }],
    sources: [
      {
        id: "orca-journeys",
        entries: [{ name: "pay/receipt", status: "VERIFIED", workspaces: ["apps/pay"] }],
      },
    ],
  };
  assert.deepEqual(satisfied(payOnly), [
    ["ui:apps/pay", true],
    ["ui:apps/wiki", false],
    ["ui:packages/design-system", false],
    ["ui:packages/gdg-lib", null],
  ]);
  assert.deepEqual(
    satisfied({
      media: [
        { path: "media/x/navbar.png", workspace: "apps/wiki" },
        { path: "media/x/loose.png", workspace: null },
        { path: "media/design-harness-reports/catalog.png", workspace: "packages/design-system" },
      ],
      sources: [],
    }),
    [
      ["ui:apps/pay", false],
      ["ui:apps/wiki", true],
      ["ui:packages/design-system", true],
      ["ui:packages/gdg-lib", null],
    ],
  );
  assert.deepEqual(
    satisfied({
      media: [{ path: "media/x/loose.png" }],
      sources: [{ id: "orca-journeys", entries: [{ name: "apps/unmapped", status: "VERIFIED" }] }],
    }),
    [
      ["ui:apps/pay", false],
      ["ui:apps/wiki", false],
      ["ui:packages/design-system", false],
      ["ui:packages/gdg-lib", null],
    ],
  );
});

test("state-machine changes come from verifier coverage and the reviewed module list, not path names", () => {
  const changes = classifyChangedFiles([
    ".agents/skills/statechart/SKILL.md",
    ".agents/skills/statechart/scripts/statechart.ts",
    ".agents/skills/statechart/scripts/test/chart.test.ts",
    "docs/engineering/statechart.md",
    "scripts/state-machine-report.mjs",
    "apps/pr/app/features/drafts/state-machine.test.ts",
    "apps/pr/app/features/drafts/state-machine.ts",
    "apps/wiki/app/features/sources/lifecycle.server.ts",
  ]);
  assert.deepEqual(changes.stateMachine, [
    "apps/pr/app/features/drafts/state-machine.ts",
    "apps/wiki/app/features/sources/lifecycle.server.ts",
  ]);
  assert.deepEqual(
    evidenceRequirements(classifyChangedFiles([".agents/skills/statechart/SKILL.md"]), {
      media: [],
      sources: [],
    }),
    [],
  );
  const repository = new URL("../../", import.meta.url);
  for (const path of STATE_MACHINE_MODULES) {
    assert.ok(existsSync(new URL(path, repository)), `${path} is listed but does not exist`);
  }
});

test("missing sources are reported as missing and never as passed", () => {
  const { summary } = buildSummary({
    commit: "abc",
    context: "local",
    changedFiles: ["apps/wiki/app/routes/home.tsx", "packages/gdg-lib/src/acl/core.ts"],
    coverage: new Map([["packages/gdg-lib/src/acl/core.ts", ["acl-boundaries"]]]),
    entries: [],
    media: [],
  });
  assert.ok(summary.sources.every((source) => !source.found && source.entries.length === 0));
  assert.ok(summary.sources.every((source) => source.reason));
  assert.deepEqual(
    summary.requirements.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui:apps/wiki", false],
      ["verifier:acl-boundaries", false],
    ],
  );
  const markdown = renderMarkdown(summary);
  assert.doesNotMatch(markdown, /\| VERIFIED \|/);
  assert.match(markdown, /No check or journey recorded a result\./);
  assert.match(markdown, /MISSING\. No screenshots or recordings were found\./);
  assert.match(markdown, /\| MISSING \| none \|/);
});

test("hosted job results distinguish skipped and failed jobs from passes", () => {
  const { summary } = buildSummary({
    commit: "abc",
    context: "hosted",
    changedFiles: [],
    coverage: new Map(),
    entries: [],
    media: [],
    hostedJobs: {
      lint: { result: "success" },
      e2e: { result: "skipped" },
      test: { result: "failure" },
    },
  });
  const hosted = summary.sources.find((source) => source.id === "hosted-jobs");
  assert.deepEqual(
    hosted.entries.map(({ name, status, details }) => [name, status, details]),
    [
      ["e2e", "NOT VERIFIED", "skipped: not selected for this change"],
      ["lint", "VERIFIED", "result success"],
      ["test", "NOT VERIFIED", "result failure"],
    ],
  );
});

test("requirements are satisfied only by matching evidence", () => {
  const changes = {
    files: 2,
    ui: ["apps/wiki/app/routes/home.tsx"],
    stateMachine: ["apps/accounts/app/features/developer-apps/oauth-clients.server.ts"],
    verifiers: {
      "accounts-client-revocation": [
        "apps/accounts/app/features/developer-apps/oauth-clients.server.ts",
      ],
    },
  };
  const inconclusive = evidenceRequirements(changes, {
    media: [],
    sources: [
      { id: "accounts-client-revocation", entries: [{ status: "INCONCLUSIVE", evidence: "x" }] },
      {
        id: "orca-journeys",
        entries: [{ name: "wiki/viewer", status: "NOT VERIFIED", workspaces: ["apps/wiki"] }],
      },
    ],
  });
  assert.deepEqual(
    inconclusive.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui:apps/wiki", false],
      ["verifier:accounts-client-revocation", false],
      ["state-diagram", null],
    ],
  );
  const present = evidenceRequirements(changes, {
    media: [{ path: "media/a.png", workspace: "apps/wiki" }],
    sources: [
      { id: "accounts-client-revocation", entries: [{ status: "VERIFIED", evidence: "y" }] },
    ],
  });
  assert.deepEqual(
    present.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui:apps/wiki", true],
      ["verifier:accounts-client-revocation", true],
      ["state-diagram", null],
    ],
  );
});

test("the CLI writes JSON, Markdown, and copied media for downloaded hosted artifacts", (t) => {
  const { root, put } = fixture(t);
  seedCoverage(put);
  put("inputs/playwright-report-wiki/run-9/result.json", {
    status: "NOT VERIFIED",
    selected: ["@gdgjp/wiki"],
    reports: [{ workspace: "apps/wiki", counts: null }],
    scratchCleaned: false,
  });
  put("inputs/playwright-report-wiki/run-9/apps/wiki/test-results/fail/shot.png", "png");
  put("inputs/acl-boundaries/2026.json", {
    verdict: "PASS",
    baseline: {},
    mutations: [{ verdict: "CAUGHT" }],
  });
  put("inputs/mutation-reports/apps/accounts/.mutator/report/mutation.json", {
    framework: { name: "mutator" },
    files: {
      "a.ts": { mutants: [{ status: "Killed" }, { status: "Survived" }, { status: "Pending" }] },
    },
  });
  put("changed.txt", "apps/wiki/app/routes/home.tsx\npackages/gdg-lib/src/acl/core.ts\n");
  put("needs.json", { lint: { result: "success" }, mutation: { result: "failure" } });
  put("local_data/pstack/verification-summary/old/media/x.png", "own output");
  const output = join(root, "out");
  const log = console.log;
  console.log = () => {};
  try {
    main(
      [
        "--commit",
        "1234567890abcdef",
        "--base",
        "fedcba",
        "--changed-files",
        join(root, "changed.txt"),
        "--hosted-jobs",
        join(root, "needs.json"),
        "--evidence",
        join(root, "inputs"),
        "--output",
        output,
      ],
      root,
    );
  } finally {
    console.log = log;
  }
  const summary = JSON.parse(readFileSync(join(output, SUMMARY_JSON), "utf8"));
  assert.equal(summary.context, "hosted");
  assert.equal(summary.commit, "1234567890abcdef");
  const status = (id) => summary.sources.find((source) => source.id === id);
  assert.equal(status("isolated-e2e").entries[0].status, "NOT VERIFIED");
  assert.match(status("isolated-e2e").entries[0].details, /no Playwright report; scratch cleanup/);
  assert.equal(status("acl-boundaries").entries[0].status, "VERIFIED");
  assert.equal(status("mutation").entries[0].status, "NOT VERIFIED");
  assert.equal(status("mutation").entries[0].name, "inputs/mutation-reports/apps/accounts");
  assert.equal(status("ci-metrics").found, false);
  assert.equal(status("accounts-client-revocation").found, false);
  assert.deepEqual(
    summary.media.map(({ path, workspace }) => [path, workspace]),
    [
      [
        "media/inputs/playwright-report-wiki/run-9/apps/wiki/test-results/fail/shot.png",
        "apps/wiki",
      ],
    ],
  );
  assert.equal(readFileSync(join(output, summary.media[0].path), "utf8"), "png");
  assert.deepEqual(
    summary.requirements.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui:apps/wiki", true],
      ["verifier:acl-boundaries", true],
    ],
  );
  const markdown = readFileSync(join(output, SUMMARY_MARKDOWN), "utf8");
  assert.match(markdown, /## Verification summary/);
  assert.match(markdown, /Local CI metrics \(\.turbo\/ci-metrics\): MISSING\./);
  assert.match(markdown, /\| Hosted CI jobs \| mutation \| {2}\| NOT VERIFIED \|/);
  assert.match(markdown, /\| @gdgjp\/wiki \| apps\/wiki \| NOT VERIFIED \|/);
  assert.match(markdown, /A missing source is not a pass/);
});

test("summary text cannot break out of a table cell or inject markup", () => {
  assert.equal(cell("a|b<!--c-->\nd"), "a\\|b&lt;!--c--&gt; d");
});

test("argument errors are explicit", () => {
  assert.throws(() => parseArguments(["--evidence"]), /requires a value/);
  assert.throws(() => parseArguments(["--since", "yesterday"]), /not a time/);
  assert.throws(() => parseArguments(["--bogus"]), /Unknown argument/);
  assert.deepEqual(parseArguments(["--evidence", "a", "--evidence", "b", "--no-local"]), {
    evidence: ["a", "b"],
    local: false,
  });
});

test("the media limit keeps evidence of every attributed workspace before more of one", () => {
  const item = (path, workspace) => ({
    file: path,
    path,
    kind: "screenshot",
    workspace,
    bytes: 1,
    recordedAt: null,
  });
  const media = [
    ...Array.from({ length: 120 }, (_, index) =>
      item(`pstack/pay/r/screenshots/${String(index).padStart(3, "0")}.png`, "apps/pay"),
    ),
    item("pstack/wiki/r/page.png", "apps/wiki"),
    item("pstack/stray.png", null),
  ];
  const { summary } = buildSummary({
    commit: "abc",
    context: "local",
    changedFiles: ["apps/wiki/app/components/Navbar.tsx"],
    coverage: new Map(),
    entries: [],
    media,
  });
  assert.equal(summary.media.length, 100);
  assert.equal(summary.mediaOmitted, 22);
  assert.deepEqual(summary.requirements[0].evidence, ["media/pstack/wiki/r/page.png"]);
  assert.deepEqual(summary.unattributed.media, ["media/pstack/stray.png"]);
});
