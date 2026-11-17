import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readVitestResult, replaceMutation, sha256, sourceDrift } from "./verify.mjs";

test("CLI exits 2 before executing a stale source tree", () => {
  const source = mkdtempSync(join(tmpdir(), "job-coverage-cli-"));
  try {
    const coverage = JSON.parse(readFileSync(new URL("../coverage.json", import.meta.url), "utf8"));
    const root = new URL("../../../../", import.meta.url);
    for (const { path } of coverage.sources) {
      mkdirSync(dirname(join(source, path)), { recursive: true });
      copyFileSync(new URL(path, root), join(source, path));
    }
    const changed = coverage.sources[0].path;
    writeFileSync(join(source, changed), "deliberate source drift");
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./verify.mjs", import.meta.url)), "--source", source],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`);
    const outputPath = run.stdout.match(/job-lifecycle-result=(.+)/)?.[1];
    assert.ok(outputPath);
    const result = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(result.status, "STALE");
    assert.deepEqual(
      result.drift.map((entry) => entry.path),
      [changed],
    );
    assert.equal(result.before, undefined);
    assert.deepEqual(result.mutations, []);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
});

test("covered source changes and deletions require review", () => {
  const root = mkdtempSync(join(tmpdir(), "job-coverage-test-"));
  try {
    writeFileSync(join(root, "source.ts"), "original");
    const coverage = { sources: [{ path: "source.ts", sha256: sha256("original") }] };
    assert.deepEqual(sourceDrift(root, coverage), []);
    writeFileSync(join(root, "source.ts"), "changed");
    assert.deepEqual(
      sourceDrift(root, coverage).map((entry) => entry.actual),
      [sha256("changed")],
    );
    rmSync(join(root, "source.ts"));
    assert.equal(sourceDrift(root, coverage)[0].actual, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a mutation replaces one expression literally and rejects ambiguous changes", () => {
  const mutation = { name: "guard", before: "guard()", after: "sql`$&`" };
  assert.equal(replaceMutation("return guard();", mutation), "return sql`$&`;");
  assert.throws(() => replaceMutation("guard(); guard()", mutation));
  assert.throws(() => replaceMutation("other()", mutation));
  assert.throws(() => replaceMutation("guard()", { ...mutation, after: "guard()" }));
});

test("mutation proof requires a failed target assertion rather than an infrastructure failure", () => {
  const assertion = {
    fullName: "rejects stale result",
    status: "failed",
    failureMessages: ["AssertionError: expected false"],
  };
  const report = (tests) => ({ success: false, testResults: [{ assertionResults: tests }] });
  assert.equal(readVitestResult(report([assertion]), 1, "rejects stale").ok, true);
  assert.equal(readVitestResult(report([]), 1, "rejects stale").ok, false);
  assert.equal(
    readVitestResult(
      report([{ ...assertion, failureMessages: ["Error: Cannot find module"] }]),
      1,
      "rejects stale",
    ).ok,
    false,
  );
  assert.equal(readVitestResult(report([assertion]), 1, "different property").ok, false);
  assert.equal(readVitestResult(report([assertion]), null, "rejects stale").ok, false);
  assert.equal(
    readVitestResult(report([{ ...assertion, status: "passed" }]), 0, "rejects stale").ok,
    false,
  );
});

test("baseline acceptance requires executed successful assertions and a successful process", () => {
  const report = {
    success: true,
    testResults: [
      { assertionResults: [{ fullName: "property", status: "passed", failureMessages: [] }] },
    ],
  };
  assert.equal(readVitestResult(report, 0).ok, true);
  assert.equal(readVitestResult({ ...report, testResults: [] }, 0).ok, false);
  assert.equal(readVitestResult({ ...report, success: false }, 0).ok, false);
  assert.equal(readVitestResult(report, 1).ok, false);
});
