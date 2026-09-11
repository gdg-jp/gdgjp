import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { changedSteps } from "../../scripts/run-ci.mjs";

test("CSS-only UI changes trigger build, behavior tests and visual checks", () => {
  const steps = changedSteps("full", ["gdg-ui-library/src/styles/tokens.css"]);
  const commands = steps.map(([, command]) => command).join("\n");
  assert.match(commands, /--filter=@gdgjp\/gdg-ui-library/);
  assert.match(commands, /gdg-ui-library test\n/);
  assert.match(commands, /gdg-ui-library test:e2e/);
  assert.doesNotMatch(commands, /--filter=@gdgjp\/tinyurl/);
});

test("UI font changes are validated even without a TypeScript edit", () => {
  const names = changedSteps("full", ["gdg-ui-library/assets/fonts/GoogleSans.woff2"]).map(
    ([name]) => name,
  );
  assert.ok(names.includes("build"));
  assert.ok(names.includes("test:gdg-ui-library"));
  assert.ok(names.includes("e2e:gdg-ui-library"));
});

test("UI E2E edits run the suite once and unrelated apps retain related tests", () => {
  const steps = changedSteps("full", [
    "gdg-ui-library/e2e/library.spec.ts",
    "tinyurl/app/lib/utils.ts",
  ]);
  assert.equal(steps.filter(([name]) => name === "e2e:gdg-ui-library").length, 1);
  assert.ok(steps.some(([, command]) => command.includes("@gdgjp/tinyurl exec vitest related")));
});

test("hosted CI includes the UI checks and isolates database setup", () => {
  const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
  for (const command of ["typecheck", "test", "build", "test:consumer"])
    assert.ok(workflow.includes(`@gdgjp/gdg-ui-library ${command}`));
  assert.match(workflow, /Migrate Accounts local database\n\s+if: matrix.app != 'gdg-ui-library'/);
});
