import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { changedSteps } from "../../scripts/run-ci.mjs";

test("CSS-only UI changes trigger build, behavior tests and visual checks", () => {
  const steps = changedSteps("full", ["ui/src/styles/tokens.css"]);
  const commands = steps.map(([, command]) => command).join("\n");
  assert.match(commands, /--filter=@gdgjp\/ui/);
  assert.match(commands, /ui test\n/);
  assert.match(commands, /ui test:e2e/);
  assert.doesNotMatch(commands, /--filter=@gdgjp\/tinyurl/);
});

test("UI font changes are validated even without a TypeScript edit", () => {
  const names = changedSteps("full", ["ui/assets/fonts/GoogleSans.woff2"]).map(([name]) => name);
  assert.ok(names.includes("build"));
  assert.ok(names.includes("test:ui"));
  assert.ok(names.includes("e2e:ui"));
});

test("UI E2E edits run the suite once and unrelated apps retain related tests", () => {
  const steps = changedSteps("full", ["ui/e2e/library.spec.ts", "tinyurl/app/lib/utils.ts"]);
  assert.equal(steps.filter(([name]) => name === "e2e:ui").length, 1);
  assert.ok(steps.some(([, command]) => command.includes("@gdgjp/tinyurl exec vitest related")));
});

test("repository script edits do not run every workspace's checks", () => {
  const steps = changedSteps("full", [".github/scripts/workflows.test.mjs"]);
  const commands = steps.map(([, command]) => command).join("\n");

  assert.match(
    commands,
    /node --test --test-reporter=dot '.github\/scripts\/workflows\.test\.mjs'/,
  );
  assert.doesNotMatch(commands, /turbo typecheck/);
  assert.doesNotMatch(commands, /turbo build/);
});

test("global configuration edits do not expand changed CI to every workspace", () => {
  const commands = changedSteps("full", ["package.json"])
    .map(([, command]) => command)
    .join("\n");

  assert.match(commands, /biome check --staged/);
  assert.doesNotMatch(commands, /turbo typecheck/);
  assert.doesNotMatch(commands, /turbo build/);
});

test("changed CI does not unconditionally typecheck unrelated Node scripts", () => {
  const steps = changedSteps("full", [".github/scripts/workflows.test.mjs"]);
  assert.ok(steps.every(([name]) => name !== "typecheck:node-scripts"));

  const packageJSON = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJSON.scripts["ci:quick"], "node scripts/run-ci.mjs quick");
  assert.equal(packageJSON.scripts["ci:full"], "node scripts/run-ci.mjs full");
});

test("hosted CI includes the UI checks and isolates database setup", () => {
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  for (const command of ["typecheck", "test", "build", "test:consumer"])
    assert.ok(workflow.includes(`@gdgjp/ui ${command}`));
  assert.equal(
    (
      workflow.match(
        /- name: Build shared UI dependency\n\s+run: pnpm --filter @gdgjp\/ui build/g,
      ) ?? []
    ).length,
    4,
  );
  assert.match(workflow, /Migrate Accounts local database\n\s+if: matrix.app != 'ui'/);
});
