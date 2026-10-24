import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  isDesignSourceFile,
  parseArgs,
  run,
  scenarioIds,
} from "../../scripts/check-design-harness.mjs";
import { changedSteps } from "../../scripts/run-ci.mjs";
import { classifyChanges } from "./changed-workspaces.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const badSource = `import { Input } from "@gdgjp/design-system";
export function Bad() {
  return <Input name="title" />;
}
`;
const goodSource = `import { Input } from "@gdgjp/design-system";
export function Good() {
  return <Input name="title" aria-label="Title" />;
}
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "design-harness-"));
  mkdirSync(join(root, "packages"));
  symlinkSync(join(repositoryRoot, "packages/design-system"), join(root, "packages/design-system"));
  mkdirSync(join(root, "apps/demo/app"), { recursive: true });
  return root;
}

async function quietly(callback) {
  const error = console.error;
  const messages = [];
  console.error = (message) => messages.push(message);
  try {
    return { status: await callback(), messages };
  } finally {
    console.error = error;
  }
}

test("only non-test app TSX is subject to source rules", () => {
  assert.equal(isDesignSourceFile("apps/deck/app/routes/home.tsx"), true);
  assert.equal(isDesignSourceFile("apps/deck/app/routes/home.test.tsx"), false);
  assert.equal(isDesignSourceFile("apps/deck/app/lib/format.ts"), false);
  assert.equal(isDesignSourceFile("apps/deck/e2e/fixture.tsx"), false);
  assert.equal(isDesignSourceFile("packages/design-system/src/Button.tsx"), false);
});

test("parses each command form", () => {
  assert.deepEqual(parseArgs(["scenarios"]), { command: "scenarios", skipBuild: false });
  assert.deepEqual(parseArgs(["source", "--staged"]), { command: "source", mode: "staged" });
  assert.deepEqual(parseArgs(["source", "--diff", "a", "b"]), {
    command: "source",
    mode: "diff",
    base: "a",
    head: "b",
  });
  assert.throws(() => parseArgs(["source", "--diff", "a"]), /BASE and HEAD/);
  assert.throws(() => parseArgs(["scenarios", "--fast"]), /Unknown option/);
  assert.throws(() => parseArgs([]), /Usage/);
});

test("discovers every harness scenario", () => {
  const ids = scenarioIds(repositoryRoot);
  assert.ok(ids.includes("scenario.profile-edit"));
  assert.ok(ids.every((id) => id.startsWith("scenario.")));
});

test("source rules fail a violating file and pass a clean one", async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, "apps/demo/app/bad.tsx"), badSource);
    writeFileSync(join(root, "apps/demo/app/good.tsx"), goodSource);
    const bad = await quietly(() => run(["source", "apps/demo/app/bad.tsx"], root));
    assert.equal(bad.status, 1);
    assert.match(bad.messages.join("\n"), /apps\/demo\/app\/bad\.tsx:3:\d+ INPUT-LABEL/);
    assert.equal(await run(["source", "apps/demo/app/good.tsx", "README.md"], root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("staged mode checks the Git index, not the working tree", async () => {
  const root = fixture();
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q");
    writeFileSync(join(root, "apps/demo/app/page.tsx"), badSource);
    git("add", "apps/demo/app/page.tsx");
    writeFileSync(join(root, "apps/demo/app/page.tsx"), goodSource);
    assert.equal((await quietly(() => run(["source", "--staged"], root))).status, 1);
    git("add", "apps/demo/app/page.tsx");
    assert.equal(await run(["source", "--staged"], root), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-commit checks staged app sources and UI scenarios", () => {
  const appSteps = changedSteps("full", ["apps/deck/app/routes/home.tsx"]);
  assert.deepEqual(appSteps.find(([name]) => name === "design-harness:source")?.slice(0, 2), [
    "design-harness:source",
    "node scripts/check-design-harness.mjs source --staged",
  ]);
  assert.equal(
    changedSteps("full", ["apps/deck/app/lib/format.ts"]).some(
      ([name]) => name === "design-harness:source",
    ),
    false,
  );
  assert.equal(
    changedSteps("full", ["packages/design-system/src/Button.test.tsx"]).some(
      ([name]) => name === "design-harness:scenarios",
    ),
    false,
  );
});

test("CI runs the design harness job for UI and app source changes", () => {
  assert.equal(classifyChanges(["apps/deck/app/routes/home.tsx"]).designSource, true);
  assert.equal(classifyChanges(["apps/deck/app/routes/home.test.tsx"]).designSource, false);
  assert.equal(classifyChanges([], { forceAll: true }).designSource, true);

  const workflow = parse(readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"));
  assert.equal(
    workflow.jobs.changes.outputs["design-source"],
    "${{ steps.changes.outputs.design-source }}",
  );
  const job = workflow.jobs["design-harness"];
  assert.match(job.if, /'@gdgjp\/design-system'/);
  assert.match(job.if, /design-source == 'true'/);
  const runs = job.steps.map((step) => step.run ?? "").join("\n");
  assert.match(runs, /check-design-harness\.mjs source --diff "\$BASE_SHA" "\$HEAD_SHA"/);
  assert.match(runs, /check-design-harness\.mjs scenarios/);
  const names = job.steps.map((step) => step.name);
  assert.ok(
    names.indexOf("Build library consumer") < names.indexOf("Check design system scenarios"),
  );
});
