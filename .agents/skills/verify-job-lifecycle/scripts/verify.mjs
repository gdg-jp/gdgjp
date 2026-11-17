import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createWorkspaceSnapshot } from "../../../../scripts/verification/workspace-snapshot.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const coveragePath = new URL("../coverage.json", import.meta.url);
const manifestPath = "apps/wiki/app/features/jobs/runner.server.verification.mutations.json";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sourceDrift(source, coverage) {
  return coverage.sources.flatMap(({ path, sha256: expected }) => {
    const file = join(source, path);
    const actual = existsSync(file) ? sha256(readFileSync(file)) : null;
    return actual === expected ? [] : [{ path, expected, actual }];
  });
}

export function replaceMutation(source, mutation) {
  const matches = source.split(mutation.before).length - 1;
  if (!mutation.before || matches !== 1)
    throw new Error(
      `${mutation.name}: expected exactly one production expression, found ${matches}`,
    );
  if (mutation.before === mutation.after)
    throw new Error(`${mutation.name}: mutation is unchanged`);
  return source.replace(mutation.before, () => mutation.after);
}

export function readVitestResult(report, exitCode, pattern) {
  const assertions = report.testResults.flatMap((suite) => suite.assertionResults);
  const passed = assertions.filter((test) => test.status === "passed");
  const failed = assertions.filter((test) => test.status === "failed");
  const skipped = assertions.length - passed.length - failed.length;
  if (pattern) {
    const expression = new RegExp(pattern);
    const rejected =
      exitCode === 1 &&
      failed.length > 0 &&
      failed.every(
        (test) =>
          expression.test(test.fullName) &&
          test.failureMessages.some((message) => message.includes("AssertionError:")),
      );
    return { ok: rejected, passed: passed.length, failed: failed.length, skipped };
  }
  return {
    ok: exitCode === 0 && report.success === true && passed.length > 0 && failed.length === 0,
    passed: passed.length,
    failed: failed.length,
    skipped,
  };
}

function options(args) {
  let source = repository;
  let mutationProof = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--mutation-proof") mutationProof = true;
    else if (args[index] === "--source" && args[index + 1]) source = resolve(args[++index]);
    else if (args[index] === "--help") return { help: true };
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return { source, mutationProof };
}

function command(commandName, args, cwd, log, env) {
  const result = spawnSync(commandName, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  if (result.error || result.signal)
    throw new Error(`${commandName} did not finish: ${result.error?.message ?? result.signal}`);
  return result;
}

function runVitest(snapshot, coverage, evidence, name, env, mutation) {
  const reportPath = join(evidence, `${name}.json`);
  const tests = mutation ? [coverage.exhaustiveTest] : coverage.tests;
  const args = ["--filter", "@gdgjp/wiki", "exec", "vitest", "run", ...tests];
  if (mutation) args.push("--testNamePattern", mutation.testNamePattern);
  args.push("--reporter=json", `--outputFile=${reportPath}`);
  const result = command("pnpm", args, snapshot.root, join(evidence, `${name}.log`), env);
  if (!existsSync(reportPath)) throw new Error(`${name}: Vitest produced no report`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const outcome = readVitestResult(report, result.status, mutation?.testNamePattern);
  if (!mutation) {
    const executed = new Set(
      report.testResults.map((suite) => relative(join(snapshot.root, "apps/wiki"), suite.name)),
    );
    if (coverage.tests.some((test) => !executed.has(test))) outcome.ok = false;
    if (outcome.skipped > 0) outcome.ok = false;
  }
  return {
    ...outcome,
    exitCode: result.status,
    report: reportPath,
    failures: report.testResults
      .flatMap((suite) => suite.assertionResults)
      .filter((test) => test.status === "failed"),
  };
}

function runGo(snapshot, evidence, env) {
  const packages = ["./internal/wiki/runner", "./internal/pr/runner"];
  const log = join(evidence, "go-runner.jsonl");
  const result = command(
    "go",
    ["test", "-race", "-count=1", "-json", ...packages],
    join(snapshot.root, "apps/cli"),
    log,
    env,
  );
  const events = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const passedPackages = events
    .filter((event) => event.Action === "pass" && !event.Test)
    .map((event) => event.Package);
  const passedTests = events.filter((event) => event.Action === "pass" && event.Test).length;
  return {
    ok: result.status === 0 && passedPackages.length === packages.length && passedTests > 0,
    exitCode: result.status,
    passedPackages,
    passedTests,
    log,
  };
}

export function main(args = process.argv.slice(2)) {
  const settings = options(args);
  if (settings.help) {
    console.info(
      "node .agents/skills/verify-job-lifecycle/scripts/verify.mjs [--mutation-proof] [--source PATH]",
    );
    return 0;
  }
  const { source, mutationProof } = settings;
  const evidence = join(
    source,
    "local_data/pstack/job-lifecycle",
    `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
  );
  mkdirSync(evidence, { recursive: true });
  const coverage = JSON.parse(readFileSync(coveragePath, "utf8"));
  const result = {
    kind: "job-lifecycle-verification",
    startedAt: new Date().toISOString(),
    source,
    syncedBaseCommit: coverage.syncedBaseCommit,
    toolVersions: { node: process.version },
    mutationProof,
    status: "FAILED",
    mutations: [],
    sourceUnchanged: false,
    scratchCleaned: false,
  };
  let snapshot;
  let exitCode = 1;
  try {
    result.drift = sourceDrift(source, coverage);
    if (result.drift.length > 0) {
      result.status = "STALE";
      exitCode = 2;
      return exitCode;
    }
    const manifest = JSON.parse(readFileSync(join(source, manifestPath), "utf8"));
    result.bounds = manifest.bounds;
    if (JSON.stringify(manifest.bounds) !== JSON.stringify(coverage.bounds))
      throw new Error("Coverage bounds differ from the production mutation manifest");
    snapshot = createWorkspaceSnapshot(source);
    if (sourceDrift(snapshot.root, coverage).length > 0)
      throw new Error("Snapshot differs from the reviewed source");
    result.sourceRevision = snapshot.revisions["."];
    result.sourceHashes = Object.fromEntries(
      coverage.sources.map(({ path, sha256: hash }) => [path, hash]),
    );
    const env = {
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      CI: "1",
      NO_COLOR: "1",
    };
    for (const [name, args] of [
      ["pnpm", ["--version"]],
      ["go", ["version"]],
    ]) {
      const version = command(
        name,
        args,
        snapshot.root,
        join(evidence, `${name}-version.log`),
        env,
      );
      if (version.status !== 0) throw new Error(`${name} is unavailable`);
      result.toolVersions[name] = version.stdout.trim();
    }
    result.before = runVitest(snapshot, coverage, evidence, "baseline-before", env);
    if (!result.before.ok) throw new Error("Unmodified real-code baseline failed");
    result.go = runGo(snapshot, evidence, env);
    if (!result.go.ok) throw new Error("Go runner wire tests failed");
    if (mutationProof) {
      for (const mutation of manifest.mutations) {
        const file = join(snapshot.root, mutation.file);
        const original = readFileSync(file);
        let outcome;
        try {
          writeFileSync(file, replaceMutation(original.toString(), mutation));
          outcome = runVitest(
            snapshot,
            coverage,
            evidence,
            `mutation-${mutation.name}`,
            env,
            mutation,
          );
        } finally {
          writeFileSync(file, original);
        }
        if (sha256(readFileSync(file)) !== sha256(original))
          throw new Error(`${mutation.name}: scratch source restoration failed`);
        result.mutations.push({ name: mutation.name, ...outcome });
        console.info(`${mutation.name}: ${outcome.ok ? "REJECTED" : "NOT REJECTED"}`);
        if (!outcome.ok)
          throw new Error(`${mutation.name}: expected target assertion did not reject mutation`);
      }
      result.after = runVitest(snapshot, coverage, evidence, "baseline-after", env);
      if (!result.after.ok) throw new Error("Restored real-code baseline failed");
    }
    result.sourceUnchanged = sourceDrift(source, coverage).length === 0;
    if (!result.sourceUnchanged) throw new Error("Covered source changed while verification ran");
    result.status = "VERIFIED";
    exitCode = 0;
  } catch (error) {
    result.error = error.message;
    console.error(error.message);
  } finally {
    if (snapshot) {
      snapshot.dispose();
      result.scratchCleaned = !existsSync(snapshot.root);
      if (!result.scratchCleaned) {
        result.status = "FAILED";
        exitCode = 1;
      }
    }
    result.completedAt = new Date().toISOString();
    const path = join(evidence, "result.json");
    writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
    console.info(`job-lifecycle-result=${path}`);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main();
