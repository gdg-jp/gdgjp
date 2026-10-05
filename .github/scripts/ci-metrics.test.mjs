import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { playwrightMetrics } from "../../scripts/ci-metrics.mjs";
import { runConcurrentSteps, runStep } from "../../scripts/run-ci.mjs";

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
    const tests = await runStep(["test", "echo pnpm exec turbo test"], { noCache });
    assert.equal(tests.command.includes("--only"), noCache);
  }
});

test("independent suites overlap while Accounts owners serialize; failures drain active work", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-ci-concurrency-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const fixture = join(cwd, "fixture.mjs");
  writeFileSync(
    fixture,
    `import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
const [directory, name] = process.argv.slice(2);
if (process.env.MINIFLARE_REGISTRY_PATH !== process.env.WRANGLER_REGISTRY_PATH) process.exit(3);
const mark = (name) => directory + "/" + name;
if (name === "fail") process.exit(7);
if (name === "accounts" || name === "tinyurl") mkdirSync(mark("lock"));
writeFileSync(mark(name + "-start"), "");
writeFileSync(mark(name + "-registry"), process.env.MINIFLARE_REGISTRY_PATH);
if (name === "accounts" || name === "wiki") {
  const peer = name === "accounts" ? "wiki" : "accounts";
  const deadline = Date.now() + 5000;
  while (!existsSync(mark(peer + "-start"))) {
    if (Date.now() > deadline) process.exit(2);
    await setTimeout(10);
  }
}
if (name === "active") {
  const deadline = Date.now() + 5000;
  while (!existsSync(mark("failure-observed"))) {
    if (Date.now() > deadline) process.exit(2);
    await setTimeout(10);
  }
}
await setTimeout(50);
if (name === "accounts" || name === "tinyurl") rmSync(mark("lock"), { recursive: true });
writeFileSync(mark(name + "-done"), "");
`,
  );
  const step = (name) => [
    `e2e:@gdgjp/${name}`,
    [process.execPath, fixture, cwd, name]
      .map((arg) => `'${arg.replaceAll("'", "'\\''")}'`)
      .join(" "),
  ];
  const passed = await runConcurrentSteps([step("accounts"), step("tinyurl"), step("wiki")]);
  assert.deepEqual(
    passed.map((metric) => metric.exitCode),
    [0, 0, 0],
  );
  const registries = ["accounts", "tinyurl", "wiki"].map((name) =>
    readFileSync(join(cwd, `${name}-registry`), "utf8"),
  );
  assert.equal(new Set(registries).size, 3);
  assert.ok(registries.every((path) => !existsSync(path)));
  // Release the active job only after the parent has observed the failure.
  // Process startup order is not guaranteed on a loaded machine.
  const originalError = console.error;
  let failed;
  console.error = (...args) => {
    originalError(...args);
    if (String(args[0]).startsWith("ci:fail e2e:@gdgjp/fail ")) {
      writeFileSync(join(cwd, "failure-observed"), "");
    }
  };
  try {
    failed = await runConcurrentSteps([step("fail"), step("active"), step("pending")], {}, 2);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(
    failed.map((metric) => metric.exitCode),
    [7, 0],
  );
  assert.ok(existsSync(join(cwd, "active-done")));
  assert.equal(existsSync(join(cwd, "pending-start")), false);
});

test("Go CI retains formatting, every vet analyzer, host builds and all six release targets", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gdg-ci-go-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, "apps/cli"), { recursive: true });
  const fixture = `#!${process.execPath}
import { appendFileSync } from "node:fs";
import { basename } from "node:path";
const command = basename(process.argv[1]);
if (command === "gofmt") {
  if (process.env.GDG_TEST_FORMAT) console.log("unformatted.go");
} else if (command === "go") {
  const target = [process.env.GOOS, process.env.GOARCH].filter(Boolean).join("/");
  appendFileSync(process.env.GDG_TEST_LOG, JSON.stringify({ args: process.argv.slice(2), target }) + "\\n");
  if (target === process.env.GDG_TEST_GO_FAILURE) process.exit(9);
}
`;
  for (const command of ["go", "gofmt", "pnpm"]) {
    writeFileSync(join(cwd, command), fixture, { mode: 0o700 });
  }
  const log = join(cwd, "commands.jsonl");
  const check = (environment = {}) => {
    writeFileSync(log, "");
    return spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/run-go-ci.mjs", import.meta.url))],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${cwd}:${process.env.PATH}`,
          GDG_TEST_LOG: log,
          ...environment,
        },
      },
    );
  };
  const passed = check();
  assert.equal(passed.status, 0, passed.stderr);
  const commands = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(commands[0].args, ["test", "-vet=all", "-ldflags=-w", "./..."]);
  assert.deepEqual(commands[1].args, ["build", "-ldflags=-w", "./..."]);
  assert.deepEqual(
    commands
      .slice(2)
      .map(({ target }) => target)
      .sort(),
    [
      "darwin/amd64",
      "darwin/arm64",
      "linux/amd64",
      "linux/arm64",
      "windows/amd64",
      "windows/arm64",
    ],
  );
  assert.notEqual(check({ GDG_TEST_GO_FAILURE: "windows/arm64" }).status, 0);
  assert.notEqual(check({ GDG_TEST_FORMAT: "1" }).status, 0);
  assert.equal(readFileSync(log, "utf8"), "");
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
    mkdirSync(join(cwd, "packages/design-system/src"), { recursive: true });
    writeFileSync(join(cwd, "packages/design-system/src/example.test.ts"), "// fixture\n");
    execFileSync("git", ["add", "packages/design-system/src/example.test.ts"], {
      cwd,
      env: fixtureEnv,
    });
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
