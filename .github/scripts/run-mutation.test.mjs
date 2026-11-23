import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { MUTATION_PROJECTS, mutatorRuns, parseArguments } from "../../scripts/run-mutation.mjs";
import { MUTATION_PROJECTS as SELECTED_PROJECTS } from "./changed-workspaces.mjs";

const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");

test("runs every project in full mode and gates diff mode on survivors", () => {
  assert.deepEqual(mutatorRuns(parseArguments([])), [
    ["--root", "packages/gdg-lib"],
    ["--root", "apps/accounts"],
  ]);
  assert.deepEqual(
    mutatorRuns(parseArguments(["--since", "abc123", "--project", "apps/accounts"])),
    [["--root", "apps/accounts", "--since", "abc123", "--fail-on-survived"]],
  );
  assert.deepEqual(mutatorRuns(parseArguments(["--", "--kill-matrix"])), [
    ["--root", "packages/gdg-lib", "--kill-matrix"],
    ["--root", "apps/accounts", "--kill-matrix"],
  ]);
});

test("rejects unknown projects, flags and missing values", () => {
  assert.throws(() => parseArguments(["--project", "apps/wiki"]), /Not a mutation project/);
  assert.throws(() => parseArguments(["--since"]), /requires a value/);
  assert.throws(() => parseArguments(["--since", "--project"]), /requires a value/);
  assert.throws(() => parseArguments(["--kill-matrix"]), /Unknown argument/);
});

test("every mutation project is selected by CI and treats its whole scope as critical", () => {
  assert.deepEqual(SELECTED_PROJECTS, MUTATION_PROJECTS);
  for (const project of MUTATION_PROJECTS) {
    const configUrl = new URL(`../../${project}/mutator.config.json`, import.meta.url);
    assert.ok(existsSync(configUrl), project);
    const config = JSON.parse(readFileSync(configUrl, "utf8"));
    assert.ok(config.include.length > 0, project);
    assert.deepEqual(config.critical, config.include, project);
  }
});

test("the hosted job diffs against the pull request base on Node 24", () => {
  const job = workflow.slice(workflow.indexOf("\n  mutation:\n"));
  assert.match(job, /^ {4}name: Mutation tests$/m);
  assert.match(job, /node-version: "24"/);
  assert.match(job, /BASE_SHA: \$\{\{ needs\.changes\.outputs\.base \}\}/);
  assert.match(job, /node scripts\/run-mutation\.mjs --since "\$BASE_SHA"/);
});
