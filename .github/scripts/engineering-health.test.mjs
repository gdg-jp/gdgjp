import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { aggregateEngineeringHealth } from "../../scripts/engineering-health.mjs";

const cli = fileURLToPath(new URL("../../scripts/engineering-health.mjs", import.meta.url));
const now = "2026-11-17T10:00:00Z";
const recent = "2026-11-17T09:00:00Z";
const since = "2026-11-16T00:00:00Z";
const timestamp = Date.parse(recent);
const metadata = { collectedAt: now, source: "fixture" };
const navigation = {
  duration: 100,
  responseStart: 20,
  domContentLoadedEventEnd: 60,
  loadEventEnd: 100,
};
const sample = {
  observedAt: recent,
  url: "http://localhost:6177/wiki/example",
  outcome: "success",
  httpStatus: 200,
  evidence: "orca-receipt.json",
  navigation,
};

function inputs(overrides = {}) {
  return {
    since,
    until: now,
    now,
    maxAgeMs: 86_400_000,
    commits: [{ sha: "a".repeat(40), committedAt: recent, subject: "fix(wiki): preserve leases" }],
    deployRuns: {
      ...metadata,
      workflow_runs: [
        {
          id: 1,
          head_sha: "a".repeat(40),
          status: "completed",
          conclusion: "success",
          created_at: recent,
        },
      ],
      total_count: 1,
    },
    ciRuns: {
      ...metadata,
      runs: [
        { startedAtUnixMs: timestamp, durationMs: 200, exitCode: 0, skippedSteps: [], steps: [] },
      ],
    },
    syntheticNavigation: { ...metadata, kind: "synthetic-navigation", samples: [sample] },
    productionRum: {
      ...metadata,
      kind: "production-rum",
      samples: [{ ...sample, url: "https://wiki.gdgs.jp/wiki/example" }],
    },
    ...overrides,
  };
}

test("keeps delivery attempts, explicit reverts, and performance provenance distinct", () => {
  const report = aggregateEngineeringHealth(
    inputs({
      commits: [
        { sha: "a".repeat(40), committedAt: recent, subject: "feat(wiki): add feature" },
        { sha: "b".repeat(40), committedAt: recent, subject: 'Revert "feat(wiki): add feature"' },
        { sha: "c".repeat(40), committedAt: "2026-11-15T09:00:00Z", subject: "old change" },
      ],
    }),
  );
  assert.equal(report.status, "VERIFIED");
  assert.equal(report.commits.count, 2);
  assert.equal(report.commits.explicitRevertCount, 1);
  assert.equal(report.commits.releaseRevertRate, null);
  assert.equal(report.deployRuns.unit, "workflow attempts, not per-application releases");
  assert.equal(report.deployRuns.deploymentFailureRate, null);
  assert.equal(report.syntheticNavigation.kind, "synthetic-navigation");
  assert.equal(report.productionRum.kind, "production-rum");
  assert.equal(report.syntheticNavigation.timingMs.durationMs.median, 100);
  assert.equal(report.syntheticNavigation.comparisonVerdict, "not evaluated");
  assert.equal(report.deliveryAndPerformance.production.basis.startsWith("not shown"), true);
  assert.ok(report.deliveryAndPerformance.apps.every((row) => row.production === null));
});

test("deployment cancellations, queued work, incomplete results and skips are never successful attempts", () => {
  const states = [
    ["completed", "success"],
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["queued", null],
    ["in_progress", null],
    ["unknown", null],
    ["completed", "skipped"],
    ["completed", "neutral"],
    ["completed", null],
  ];
  const report = aggregateEngineeringHealth(
    inputs({
      deployRuns: {
        ...metadata,
        total_count: 100,
        workflow_runs: states.map(([status, conclusion], id) => ({
          id,
          created_at: recent,
          status,
          conclusion,
        })),
      },
    }),
  );
  assert.deepEqual(report.deployRuns.counts, {
    successful: 1,
    failed: 1,
    cancelled: 1,
    queued: 1,
    inProgress: 1,
    incomplete: 1,
    skipped: 1,
    neutral: 1,
    other: 1,
  });
  assert.equal(report.deployRuns.complete, false);
  assert.equal(report.status, "NOT VERIFIED");
  assert.ok(report.gaps.some((gap) => gap.includes("pagination")));
});

test("deployment export completeness requires a boolean", () => {
  const values = inputs();
  values.deployRuns.complete = "false";
  assert.throws(() => aggregateEngineeringHealth(values), /complete must be a boolean/);
});

test("CI reports preserve failed, partial, cancelled, incomplete, cached and flaky work", () => {
  const run = (value) => ({
    startedAtUnixMs: timestamp,
    durationMs: 50,
    steps: [{ name: "lint", exitCode: 0 }],
    ...value,
  });
  const counts = { passed: 4, failed: 1, skipped: 2, flaky: 1 };
  const report = aggregateEngineeringHealth(
    inputs({
      ciRuns: {
        ...metadata,
        runs: [
          run({
            exitCode: 0,
            turboRuns: [
              {
                id: "one",
                tasks: [
                  { taskId: "build", cache: "HIT" },
                  { taskId: "test", cache: "MISS" },
                ],
              },
            ],
            steps: [{ name: "e2e:wiki", exitCode: 0, playwright: [{ counts, cached: true }] }],
          }),
          run({ exitCode: 1, steps: [{ name: "e2e:accounts" }] }),
          run({ exitCode: 143, signal: "SIGTERM" }),
          run({ exitCode: null }),
          run({ exitCode: 0, skippedSteps: ["e2e:wiki"] }),
        ],
      },
    }),
  );
  assert.deepEqual(report.ciRuns.counts, {
    passed: 1,
    failed: 1,
    cancelled: 1,
    incomplete: 1,
    partial: 1,
  });
  assert.deepEqual(report.ciRuns.browserCounts, {
    reportCount: 1,
    missingReportCount: 1,
    ...counts,
    cachedReports: 1,
  });
  assert.equal(report.ciRuns.skippedStepCount, 1);
  assert.equal(report.ciRuns.cachedTaskCount, 1);
  assert.equal(report.ciRuns.uncachedTaskCount, 1);
  assert.deepEqual(report.ciRuns.runDurationMs.failed, {
    sampleCount: 1,
    median: 50,
    min: 50,
    max: 50,
  });
});

test("empty and failed browser samples do not become zero-millisecond successes", () => {
  const empty = aggregateEngineeringHealth(
    inputs({ syntheticNavigation: { ...metadata, kind: "synthetic-navigation", samples: [] } }),
  );
  assert.equal(empty.syntheticNavigation.sampleCount, 0);
  assert.deepEqual(empty.syntheticNavigation.timingMs.durationMs, {
    sampleCount: 0,
    median: null,
    min: null,
    max: null,
  });
  const report = aggregateEngineeringHealth(
    inputs({
      syntheticNavigation: {
        ...metadata,
        kind: "synthetic-navigation",
        samples: [
          { ...sample, outcome: "failed", httpStatus: 503, navigation: undefined },
          { ...sample, navigation: { ...navigation, duration: 80 } },
          { ...sample, navigation: { ...navigation, duration: 120 } },
        ],
      },
    }),
  );
  assert.equal(report.syntheticNavigation.failedSampleCount, 1);
  assert.equal(report.syntheticNavigation.successfulSampleCount, 2);
  assert.equal(report.syntheticNavigation.failures[0].httpStatus, 503);
  assert.deepEqual(report.syntheticNavigation.timingMs.durationMs, {
    sampleCount: 2,
    median: 100,
    min: 80,
    max: 120,
  });
});

test("zero exit without executed checks is incomplete and report URLs omit credentials", () => {
  const report = aggregateEngineeringHealth(
    inputs({
      ciRuns: {
        ...metadata,
        runs: [
          { startedAtUnixMs: timestamp, exitCode: 0, steps: [] },
          { startedAtUnixMs: timestamp, exitCode: 0, steps: [{ name: "lint", exitCode: 1 }] },
        ],
      },
      syntheticNavigation: {
        ...metadata,
        kind: "synthetic-navigation",
        samples: [
          {
            ...sample,
            url: "http://fixture:secret@localhost:6177/wiki/example?token=secret#secret",
          },
        ],
      },
    }),
  );
  assert.equal(report.ciRuns.counts.passed, 0);
  assert.equal(report.ciRuns.counts.incomplete, 1);
  assert.equal(report.ciRuns.counts.failed, 1);
  assert.equal(report.syntheticNavigation.successes[0].url, "http://localhost:6177/wiki/example");
});

test("missing or stale evidence remains explicit even when old files were collected just now", () => {
  const missing = aggregateEngineeringHealth(
    inputs({
      deployRuns: undefined,
      ciRuns: undefined,
      syntheticNavigation: undefined,
      productionRum: undefined,
    }),
  );
  assert.equal(missing.status, "NOT VERIFIED");
  assert.equal(missing.gaps.length, 4);
  assert.deepEqual(missing.productionRum, {
    status: "unavailable",
    source: null,
    collectedAt: null,
    ageMs: null,
  });
  const stale = aggregateEngineeringHealth(inputs({ maxAgeMs: 1000 }));
  assert.equal(stale.ciRuns.status, "stale");
  assert.equal(stale.syntheticNavigation.status, "stale");
  assert.equal(stale.syntheticNavigation.ageMs, 0);
  assert.equal(stale.syntheticNavigation.observationAgeMs, 3_600_000);
  assert.equal(stale.status, "NOT VERIFIED");
});

test("invalid measurements and synthetic data relabeled as production RUM fail closed", () => {
  for (const override of [
    { since: "not-a-date" },
    { since: "2026-11-18T00:00:00Z" },
    { maxAgeMs: -1 },
    { ciRuns: { ...metadata, runs: [{ startedAtUnixMs: timestamp, exitCode: "0" }] } },
    {
      ciRuns: {
        ...metadata,
        runs: [
          {
            startedAtUnixMs: timestamp,
            exitCode: 0,
            steps: [{ playwright: [{ counts: { passed: -1 } }] }],
          },
        ],
      },
    },
    { deployRuns: { ...metadata, workflow_runs: "invalid" } },
    { productionRum: { ...metadata, kind: "synthetic-navigation", samples: [sample] } },
    { productionRum: { ...metadata, kind: "production-rum", samples: [sample] } },
    {
      productionRum: {
        ...metadata,
        kind: "production-rum",
        samples: [{ ...sample, url: "https://wiki.gdgs.jp", synthetic: true }],
      },
    },
    {
      syntheticNavigation: {
        ...metadata,
        kind: "synthetic-navigation",
        samples: [{ ...sample, httpStatus: 500 }],
      },
    },
    {
      syntheticNavigation: {
        ...metadata,
        kind: "synthetic-navigation",
        samples: [{ ...sample, navigation: { ...navigation, duration: 0 } }],
      },
    },
    {
      syntheticNavigation: {
        ...metadata,
        collectedAt: "2026-11-17T11:00:00Z",
        kind: "synthetic-navigation",
        samples: [],
      },
    },
  ])
    assert.throws(() => aggregateEngineeringHealth(inputs(override)));
});

const gitEnvironment = { ...process.env };
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" })
  .trim()
  .split("\n"))
  delete gitEnvironment[name];

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "engineering-health-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const git = (args, date) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...gitEnvironment,
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      },
    });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["config", "user.name", "Fixture"]);
  git(["config", "user.email", "fixture@example.test"]);
  git(["config", "core.hooksPath", join(root, "empty-hooks")]);
  const save = (subject, date) => {
    writeFileSync(join(repo, "source.txt"), subject);
    git(["add", "source.txt"]);
    git(["commit", "--quiet", "-m", subject], date);
  };
  save("old change", "2026-11-15T10:00:00Z");
  save("feat: ship", recent);
  save('Revert "feat: ship"', "2026-11-17T09:30:00Z");
  return { root, repo, git, save };
}

test("real CLI reads only the requested HEAD window and writes an idempotent report", (t) => {
  const f = repository(t);
  f.git(["checkout", "--quiet", "-b", "unmerged"]);
  f.save("unmerged private work", recent);
  f.git(["checkout", "--quiet", "main"]);
  const before = f.git(["status", "--porcelain"]);
  const output = join(f.root, "reports/health.json");
  const args = [cli, "--repo", f.repo, "--since", since, "--now", now, "--output", output];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(process.execPath, args, { env: gitEnvironment, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const report = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(report.commits.count, 2);
  assert.equal(report.commits.explicitRevertCount, 1);
  assert.equal(report.productionRum.status, "unavailable");
  assert.equal(report.deliveryAndPerformance.throughput.commits, 2);
  assert.match(report.deliveryAndPerformance.throughput.perAppCommitBasis, /^commits whose/);
  assert.equal(report.deliveryAndPerformance.production.basis, "unavailable");
  assert.equal(report.status, "NOT VERIFIED");
  assert.equal(f.git(["status", "--porcelain"]), before);
});

test("real CLI preserves all local CI outcomes and refuses malformed input or unrelated output", (t) => {
  const f = repository(t);
  const directory = join(f.root, "ci");
  mkdirSync(directory);
  writeFileSync(
    join(directory, "passed.json"),
    JSON.stringify({
      startedAtUnixMs: timestamp,
      exitCode: 0,
      steps: [{ name: "lint", exitCode: 0 }],
      skippedSteps: [],
    }),
  );
  writeFileSync(
    join(directory, "failed.json"),
    JSON.stringify({ startedAtUnixMs: timestamp, exitCode: 1, steps: [] }),
  );
  const args = [
    cli,
    "--repo",
    f.repo,
    "--since",
    since,
    "--now",
    now,
    "--ci-metrics-dir",
    directory,
  ];
  const result = spawnSync(process.execPath, args, { env: gitEnvironment, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).ciRuns.counts, {
    passed: 1,
    failed: 1,
    cancelled: 0,
    incomplete: 0,
    partial: 0,
  });
  writeFileSync(join(directory, "broken.json"), "{broken");
  assert.equal(spawnSync(process.execPath, args, { env: gitEnvironment }).status, 1);
  const unrelated = join(f.root, "unrelated.json");
  writeFileSync(unrelated, '{"source":"important"}');
  const rejected = spawnSync(
    process.execPath,
    [cli, "--repo", f.repo, "--since", since, "--now", now, "--output", unrelated],
    { env: gitEnvironment, encoding: "utf8" },
  );
  assert.equal(rejected.status, 1);
  assert.equal(readFileSync(unrelated, "utf8"), '{"source":"important"}');
});

test("explicitly incomplete deployment exports remain incomplete despite matching counts", () => {
  const values = inputs();
  values.deployRuns.complete = false;
  const report = aggregateEngineeringHealth(values);
  assert.equal(report.deployRuns.complete, false);
  assert.equal(report.status, "NOT VERIFIED");
  assert.ok(report.gaps.some((gap) => gap.includes("pagination")));
});
