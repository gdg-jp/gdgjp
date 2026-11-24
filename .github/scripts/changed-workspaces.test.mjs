import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { classifyChanges } from "./changed-workspaces.mjs";

test("every first-party configured browser suite is selected for complete CI", () => {
  const expected = [];
  for (const group of ["apps", "packages"]) {
    const directory = new URL(`../../${group}/`, import.meta.url);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || `${group}/${entry.name}` === "apps/learn") continue;
      const workspace = new URL(`${entry.name}/`, directory);
      if (!existsSync(new URL("playwright.config.ts", workspace))) continue;
      const manifest = JSON.parse(readFileSync(new URL("package.json", workspace), "utf8"));
      assert.ok(manifest.scripts["test:e2e"], manifest.name);
      expected.push(entry.name);
      assert.ok(
        classifyChanges([`${group}/${entry.name}/playwright.config.ts`]).e2e.includes(entry.name),
      );
    }
  }
  assert.deepEqual(classifyChanges([], { forceAll: true }).e2e.sort(), expected.sort());
});

test("selects only the directly changed application", () => {
  const result = classifyChanges(["apps/scheduler/migrations/0001_example.sql"]);

  assert.deepEqual(result.ci, ["@gdgjp/scheduler"]);
  assert.deepEqual(result.build, ["@gdgjp/scheduler"]);
  assert.deepEqual(result.e2e, ["scheduler"]);
  assert.deepEqual(
    result.deploy.map(({ app }) => app),
    ["scheduler"],
  );
});

test("selects Wiki E2E for Wiki application and harness changes", () => {
  assert.deepEqual(classifyChanges(["apps/wiki/app/root.tsx"]).e2e, ["wiki"]);
  assert.deepEqual(classifyChanges(["apps/wiki/tests/e2e/setup.ts"]).e2e, ["wiki"]);
  assert.deepEqual(classifyChanges(["apps/wiki/playwright.config.ts"]).e2e, ["wiki"]);
});

test("selects Pay browser checks for application and harness changes", () => {
  assert.deepEqual(classifyChanges(["apps/pay/app/root.tsx"]).e2e, ["pay"]);
  assert.deepEqual(classifyChanges(["apps/pay/e2e/ui-harness.tsx"]).e2e, ["pay"]);
  assert.deepEqual(classifyChanges(["apps/pay/playwright.config.ts"]).e2e, ["pay"]);
});

test("runs the UI property dependents' checks without deploying them", () => {
  const result = classifyChanges(["packages/ui-properties/src/engine.ts"]);
  assert.deepEqual(result.e2e, ["accounts", "tinyurl", "wiki", "pay", "ost", "screen", "pr"]);
  assert.ok(result.ci.includes("@gdgjp/ui-properties"));
  assert.deepEqual(result.deploy, []);
});

test("propagates gdg-lib changes to every dependent application", () => {
  const result = classifyChanges(["packages/gdg-lib/src/auth/session.ts"]);

  assert.deepEqual(result.ci, [
    "@gdgjp/accounts",
    "@gdgjp/tinyurl",
    "@gdgjp/wiki",
    "@gdgjp/img",
    "@gdgjp/scheduler",
    "@gdgjp/sns",
    "@gdgjp/connpass",
    "@gdgjp/pay",
    "@gdgjp/roster",
    "@gdgjp/mc",
    "@gdgjp/screen",
    "@gdgjp/deck",
    "@gdgjp/roulette",
    "@gdgjp/pr",
    "@gdgjp/meet",
    "@gdgjp/website",
    "@gdgjp/gdg-lib",
  ]);
  assert.deepEqual(
    result.deploy.map(({ app }) => app),
    [
      "accounts",
      "tinyurl",
      "wiki",
      "img",
      "scheduler",
      "sns",
      "connpass",
      "pay",
      "roster",
      "mc",
      "screen",
      "deck",
      "roulette",
      "pr",
      "meet",
      "website",
    ],
  );
});

test("fans common configuration changes out to every target", () => {
  const result = classifyChanges(["pnpm-lock.yaml"]);

  assert.equal(result.ci.length, 25);
  assert.equal(result.build.length, 23);
  assert.equal(result.deploy.length, 21);
  assert.equal(result.openapi, true);
});

test("treats workflow and detector changes as global for their consumers", () => {
  const ci = classifyChanges([".github/workflows/ci.yml"]);
  const deploy = classifyChanges([".github/workflows/deploy.yml"]);
  const detector = classifyChanges([".github/scripts/changed-workspaces.mjs"]);
  const action = classifyChanges([".github/actions/playwright-fonts/action.yml"]);

  assert.equal(ci.ci.length, 25);
  assert.equal(ci.deploy.length, 0);
  assert.equal(deploy.ci.length, 0);
  assert.equal(deploy.deploy.length, 21);
  assert.equal(detector.ci.length, 25);
  assert.equal(detector.deploy.length, 21);
  assert.equal(action.ci.length, 25);
  assert.equal(action.deploy.length, 0);
});

test("ignores unrelated documentation changes", () => {
  const result = classifyChanges(["docs/operations.md"]);

  assert.deepEqual(result.ci, []);
  assert.deepEqual(result.build, []);
  assert.deepEqual(result.e2e, []);
  assert.deepEqual(result.deploy, []);
  assert.equal(result.lint, false);
  assert.equal(result.openapi, false);
});

test("recognizes both sides of a rename and deleted application files", () => {
  const result = classifyChanges([
    "apps/tinyurl/old.ts",
    "apps/scheduler/new.ts",
    "apps/img/deleted.ts",
  ]);

  assert.deepEqual(result.ci, ["@gdgjp/tinyurl", "@gdgjp/img", "@gdgjp/scheduler"]);
  assert.equal(result.lint, true);
});

test("limits OpenAPI checks to contract and generator inputs", () => {
  assert.equal(classifyChanges(["apps/accounts/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["apps/cli/internal/wiki/generate.go"]).openapi, true);
  assert.equal(classifyChanges(["apps/connpass/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["apps/sns/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["apps/cli/internal/connpass/generate.go"]).openapi, true);
  assert.equal(classifyChanges(["apps/accounts/app/routes/home.tsx"]).openapi, false);
});

test("manual execution selects every CI and deploy target", () => {
  const result = classifyChanges([], { forceAll: true });

  assert.equal(result.full, true);
  assert.equal(result.ci.length, 25);
  assert.equal(result.deploy.length, 21);
  assert.equal(result.lint, true);
  assert.equal(result.cli, true);
});

test("GDG UI changes validate and deploy its consumers", () => {
  const result = classifyChanges(["packages/design-system/src/styles/tokens.css"]);
  assert.deepEqual(result.ci, [
    "@gdgjp/design-system",
    "@gdgjp/accounts",
    "@gdgjp/tinyurl",
    "@gdgjp/wiki",
    "@gdgjp/img",
    "@gdgjp/scheduler",
    "@gdgjp/pay",
    "@gdgjp/roster",
    "@gdgjp/mc",
    "@gdgjp/screen",
    "@gdgjp/deck",
    "@gdgjp/roulette",
    "@gdgjp/pr",
    "@gdgjp/meet",
  ]);
  assert.deepEqual(result.build, [
    "@gdgjp/design-system",
    "@gdgjp/accounts",
    "@gdgjp/tinyurl",
    "@gdgjp/wiki",
    "@gdgjp/img",
    "@gdgjp/scheduler",
    "@gdgjp/pay",
    "@gdgjp/roster",
    "@gdgjp/mc",
    "@gdgjp/screen",
    "@gdgjp/deck",
    "@gdgjp/roulette",
    "@gdgjp/pr",
    "@gdgjp/meet",
  ]);
  assert.deepEqual(result.e2e, [
    "design-system",
    "accounts",
    "tinyurl",
    "wiki",
    "img",
    "scheduler",
    "pay",
    "roster",
    "mc",
    "screen",
    "deck",
    "roulette",
    "pr",
    "meet",
  ]);
  assert.deepEqual(
    result.deploy.map(({ app }) => app),
    [
      "accounts",
      "tinyurl",
      "wiki",
      "img",
      "scheduler",
      "pay",
      "roster",
      "mc",
      "screen",
      "deck",
      "roulette",
      "pr",
      "meet",
    ],
  );
});

test("UI gitlink updates select the same targets as library source changes", () => {
  assert.deepEqual(
    classifyChanges(["packages/design-system"]),
    classifyChanges(["packages/design-system/README.md"]),
  );
});

test("a skills submodule update builds, tests and deploys pr", () => {
  for (const files of [["skills"], ["skills/pr-playbook/rules.json"]]) {
    const result = classifyChanges(files);
    assert.deepEqual(result.ci, ["@gdgjp/pr"]);
    assert.deepEqual(result.e2e, ["pr"]);
    assert.deepEqual(
      result.deploy.map(({ app }) => app),
      ["pr"],
    );
  }
});

test("gates the CLI Go job on cli/ changes", () => {
  assert.equal(classifyChanges(["apps/cli/internal/command/wiki.go"]).cli, true);
  assert.equal(classifyChanges(["packages/gdg-lib/src/acl/agent.ts"]).cli, true);
  assert.equal(classifyChanges(["scripts/run-go-ci.mjs"]).cli, true);
  for (const file of [
    "apps/tinyurl/app/features/campaigns/campaign-cli-analytics.ts",
    "apps/wiki/app/features/spaces/shared.ts",
    "apps/wiki/app/features/jobs/answer.server.ts",
    "skills",
  ]) {
    assert.equal(classifyChanges([file]).cli, true, file);
  }
  assert.equal(classifyChanges(["docs/operations.md"]).cli, false);
  assert.equal(classifyChanges(["pnpm-lock.yaml"]).cli, true);
});

test("engineering inputs run real installation and ACL checks in hosted and staged CI", async () => {
  const { changedSteps } = await import("../../scripts/run-ci.mjs");
  for (const file of [
    ".agents/skills/poteto-mode/SKILL.md",
    ".agents/skills/verify-acl-boundaries/scripts/verify.mjs",
    ".agents/skills/verify-acl-boundaries/coverage.json",
    "scripts/pstack.mjs",
    "packages/gdg-lib/src/acl/core.ts",
    "tsconfig.node-scripts.json",
  ]) {
    assert.equal(classifyChanges([file]).engineering, true, file);
    const steps = changedSteps("full", [file]);
    assert.ok(
      steps.some(([, command]) => command === "node scripts/pstack.mjs doctor"),
      file,
    );
    assert.ok(
      steps.some(([, command]) =>
        command.endsWith("verify-acl-boundaries/scripts/verify.mjs --mutation-proof"),
      ),
      file,
    );
  }
  assert.equal(classifyChanges(["docs/operations.md"]).engineering, false);
});

test("affected executor and detector edits run their staged behavioral tests", async () => {
  const { changedSteps } = await import("../../scripts/run-ci.mjs");
  for (const name of ["run-affected", "changed-workspaces"]) {
    const steps = changedSteps("full", [`.github/scripts/${name}.mjs`]);
    const command = steps.find(([step]) => step === "test:scripts")?.[1];
    assert.ok(command?.includes(`.github/scripts/${name}.test.mjs`), name);
  }
});

test("CI runner and pstack edits select their own regression coverage", async () => {
  const { changedSteps } = await import("../../scripts/run-ci.mjs");
  for (const [file, expected] of [
    ["scripts/run-ci.mjs", ".github/scripts/changed-workspaces.test.mjs"],
    ["scripts/pstack.mjs", ".github/scripts/pstack.test.mjs"],
  ]) {
    assert.equal(classifyChanges([file]).scriptTests, true, file);
    const command = changedSteps("full", [file]).find(([step]) => step === "test:scripts")?.[1];
    assert.ok(command?.includes(expected), file);
  }
});

test("staged unit tests skip workspaces without a test script", async () => {
  const { changedSteps } = await import("../../scripts/run-ci.mjs");
  const names = changedSteps("staged", [
    "apps/live-checkin/app/page.tsx",
    "apps/wiki/app/root.tsx",
  ]).map(([step]) => step);
  assert.ok(!names.includes("test:@gdgjp/live-checkin"));
  assert.ok(names.includes("test:@gdgjp/wiki"));
});

test("selects mutation testing for the projects whose files changed", () => {
  assert.deepEqual(classifyChanges(["packages/gdg-lib/src/auth/rp.ts"]).mutation, [
    "packages/gdg-lib",
  ]);
  assert.deepEqual(classifyChanges(["apps/accounts/mutator.accepted.json"]).mutation, [
    "apps/accounts",
  ]);
  assert.deepEqual(
    classifyChanges(["apps/accounts/app/features/oauth/rp-session.server.ts", "packages/gdg-lib/x"])
      .mutation,
    ["packages/gdg-lib", "apps/accounts"],
  );
  assert.deepEqual(classifyChanges(["scripts/run-mutation.mjs"]).mutation, [
    "packages/gdg-lib",
    "apps/accounts",
  ]);
  assert.equal(classifyChanges(["scripts/run-mutation.mjs"]).scriptTests, true);
  assert.deepEqual(classifyChanges(["apps/wiki/app/root.tsx"]).mutation, []);
  assert.deepEqual(classifyChanges(["pnpm-lock.yaml"]).mutation, []);
  assert.deepEqual(
    classifyChanges(["apps/accounts-oidc-client-demo/src/auth/oidc.ts"]).mutation,
    [],
  );
  assert.deepEqual(classifyChanges([], { forceAll: true }).mutation, [
    "packages/gdg-lib",
    "apps/accounts",
  ]);
});
