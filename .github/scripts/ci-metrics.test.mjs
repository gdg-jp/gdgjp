import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { playwrightMetrics } from "../../scripts/ci-metrics.mjs";
import { runStep } from "../../scripts/run-ci.mjs";

const runner = fileURLToPath(new URL("../../scripts/run-ci.mjs", import.meta.url));
const fixtureEnv = { ...process.env };
for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" })
  .trim()
  .split("\n")) {
  delete fixtureEnv[name];
}

test("Playwright metrics distinguish first-test delay, attempts, cached results and stale files", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-playwright-metrics-"));
  try {
    mkdirSync(join(cwd, ".turbo"));
    writeFileSync(
      join(cwd, ".turbo/ci-playwright.json"),
      JSON.stringify({
        stats: {
          startTime: new Date(1000).toISOString(),
          duration: 250,
          expected: 0,
          unexpected: 1,
          skipped: 0,
          flaky: 0,
        },
        suites: [
          {
            suites: [
              {
                specs: [
                  {
                    file: "example.spec.ts",
                    title: "failure",
                    tests: [
                      {
                        projectName: "chromium",
                        results: [
                          {
                            status: "failed",
                            retry: 0,
                            startTime: new Date(1100).toISOString(),
                            duration: 150,
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const metric = playwrightMetrics(cwd, 900);
    assert.equal(metric.firstTestDelayMs, 100);
    assert.equal(metric.durationMs, 250);
    assert.equal(metric.counts.failed, 1);
    assert.equal(metric.tests[0].durationMs, 150);
    assert.equal(playwrightMetrics(cwd, 2000), undefined);
    assert.equal(playwrightMetrics(cwd, 2000, true).cached, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("step metrics record elapsed time and failure exit codes", async () => {
  for (const exitCode of [0, 7]) {
    const metric = await runStep([
      "fixture",
      `'${process.execPath}' -e 'setTimeout(() => process.exit(${exitCode}), 25)'`,
    ]);
    assert.equal(metric.exitCode, exitCode);
    assert.ok(metric.durationMs >= 25);
    assert.ok(metric.startedAtUnixMs <= Date.now());
    assert.equal(metric.signal, null);
  }
});

test("task summaries preserve task arguments with and without caching", async () => {
  for (const noCache of [false, true]) {
    const metric = await runStep(["command", "echo pnpm exec turbo test -- --reporter=minimal"], {
      noCache,
    });
    assert.match(metric.command, /turbo run --summarize=true /);
    assert.equal(metric.command.includes("--cache=local:,remote:"), noCache);
    assert.match(metric.command, / test -- --reporter=minimal$/);
  }
});

test("an empty index writes a machine-readable zero-step report", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-ci-metrics-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd, env: fixtureEnv });
    const result = spawnSync(
      process.execPath,
      [runner, "full", "--changed", "--no-cache", "--metrics=metrics/result.json"],
      { cwd, env: fixtureEnv, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(cwd, "metrics/result.json"), "utf8"));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.cache, "disabled");
    assert.equal(report.exitCode, 0);
    assert.ok(report.durationMs > 0);
    assert.deepEqual(report.files, []);
    assert.deepEqual(report.steps, []);
    assert.deepEqual(report.skippedSteps, []);
    assert.deepEqual(report.turboRuns, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("runtime configuration failures still write a failed report", () => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-ci-planning-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd, env: fixtureEnv });
    mkdirSync(join(cwd, "design-system/src"), { recursive: true });
    writeFileSync(join(cwd, "design-system/src/example.test.ts"), "// fixture\n");
    execFileSync("git", ["add", "design-system/src/example.test.ts"], { cwd, env: fixtureEnv });
    const result = spawnSync(
      process.execPath,
      [runner, "full", "--changed", "--metrics=result.json"],
      {
        cwd,
        env: { ...fixtureEnv, GDG_CI_NODE: "/invalid/runtime" },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    const report = JSON.parse(readFileSync(join(cwd, "result.json"), "utf8"));
    assert.equal(report.exitCode, 1);
    assert.match(report.error, /gdgjp.ciNode/);
    assert.deepEqual(report.steps, []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
