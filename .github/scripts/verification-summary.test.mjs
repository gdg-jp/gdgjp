import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  SUMMARY_JSON,
  SUMMARY_MARKDOWN,
  buildSummary,
  cell,
  classifyChangedFiles,
  collectEvidence,
  evidenceRequirements,
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
  assert.deepEqual(
    media.map(({ path, kind }) => [path, kind]),
    [
      ["pstack/e2e/run-1/apps/wiki/test-results/home/shot.png", "screenshot"],
      ["pstack/platform/run-3/journey.webm", "recording"],
    ],
  );
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
      ["ui", false],
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
      { id: "orca-journeys", entries: [{ name: "wiki/viewer", status: "NOT VERIFIED" }] },
    ],
  });
  assert.deepEqual(
    inconclusive.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui", false],
      ["verifier:accounts-client-revocation", false],
      ["state-diagram", null],
    ],
  );
  const present = evidenceRequirements(changes, {
    media: [{ path: "media/a.png" }],
    sources: [
      { id: "accounts-client-revocation", entries: [{ status: "VERIFIED", evidence: "y" }] },
    ],
  });
  assert.deepEqual(
    present.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui", true],
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
    summary.media.map((item) => item.path),
    ["media/inputs/playwright-report-wiki/run-9/apps/wiki/test-results/fail/shot.png"],
  );
  assert.equal(readFileSync(join(output, summary.media[0].path), "utf8"), "png");
  assert.deepEqual(
    summary.requirements.map(({ id, satisfied }) => [id, satisfied]),
    [
      ["ui", true],
      ["verifier:acl-boundaries", true],
    ],
  );
  const markdown = readFileSync(join(output, SUMMARY_MARKDOWN), "utf8");
  assert.match(markdown, /## Verification summary/);
  assert.match(markdown, /Local CI metrics \(\.turbo\/ci-metrics\): MISSING\./);
  assert.match(markdown, /\| Hosted CI jobs \| mutation \| NOT VERIFIED \|/);
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
