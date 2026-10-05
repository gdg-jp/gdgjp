import assert from "node:assert/strict";
import test from "node:test";

import { classifyChanges } from "./changed-workspaces.mjs";

test("selects only the directly changed application", () => {
  const result = classifyChanges(["scheduler/migrations/0001_example.sql"]);

  assert.deepEqual(result.ci, ["@gdgjp/scheduler"]);
  assert.deepEqual(result.build, ["@gdgjp/scheduler"]);
  assert.deepEqual(result.e2e, ["scheduler"]);
  assert.deepEqual(
    result.deploy.map(({ app }) => app),
    ["scheduler"],
  );
});

test("selects Wiki E2E for Wiki application and harness changes", () => {
  assert.deepEqual(classifyChanges(["wiki/app/root.tsx"]).e2e, ["wiki"]);
  assert.deepEqual(classifyChanges(["wiki/tests/e2e/setup.ts"]).e2e, ["wiki"]);
  assert.deepEqual(classifyChanges(["wiki/playwright.config.ts"]).e2e, ["wiki"]);
});

test("selects Pay browser checks for application and harness changes", () => {
  assert.deepEqual(classifyChanges(["pay/app/root.tsx"]).e2e, ["pay"]);
  assert.deepEqual(classifyChanges(["pay/e2e/ui-harness.tsx"]).e2e, ["pay"]);
  assert.deepEqual(classifyChanges(["pay/playwright.config.ts"]).e2e, ["pay"]);
});

test("propagates gdg-lib changes to every dependent application", () => {
  const result = classifyChanges(["gdg-lib/src/auth/session.ts"]);

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
    "@gdgjp/website",
    "@gdgjp/gdg-lib",
    "@gdgjp/agents",
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
      "website",
      "agents",
    ],
  );
});

test("fans common configuration changes out to every target", () => {
  const result = classifyChanges(["pnpm-lock.yaml"]);

  assert.equal(result.ci.length, 17);
  assert.equal(result.build.length, 15);
  assert.equal(result.deploy.length, 13);
  assert.equal(result.openapi, true);
});

test("treats workflow and detector changes as global for their consumers", () => {
  const ci = classifyChanges([".github/workflows/ci.yml"]);
  const deploy = classifyChanges([".github/workflows/deploy.yml"]);
  const detector = classifyChanges([".github/scripts/changed-workspaces.mjs"]);

  assert.equal(ci.ci.length, 17);
  assert.equal(ci.deploy.length, 0);
  assert.equal(deploy.ci.length, 0);
  assert.equal(deploy.deploy.length, 13);
  assert.equal(detector.ci.length, 17);
  assert.equal(detector.deploy.length, 13);
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
  const result = classifyChanges(["tinyurl/old.ts", "scheduler/new.ts", "img/deleted.ts"]);

  assert.deepEqual(result.ci, ["@gdgjp/tinyurl", "@gdgjp/img", "@gdgjp/scheduler"]);
  assert.equal(result.lint, true);
});

test("limits OpenAPI checks to contract and generator inputs", () => {
  assert.equal(classifyChanges(["accounts/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["cli/internal/wiki/generate.go"]).openapi, true);
  assert.equal(classifyChanges(["connpass/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["sns/openapi/openapi.yaml"]).openapi, true);
  assert.equal(classifyChanges(["cli/internal/connpass/generate.go"]).openapi, true);
  assert.equal(classifyChanges(["accounts/app/routes/home.tsx"]).openapi, false);
});

test("manual execution selects every CI and deploy target", () => {
  const result = classifyChanges([], { forceAll: true });

  assert.equal(result.full, true);
  assert.equal(result.ci.length, 17);
  assert.equal(result.deploy.length, 13);
  assert.equal(result.lint, true);
  assert.equal(result.cli, true);
});

test("gates the CLI Go job on cli/ changes", () => {
  assert.equal(classifyChanges(["cli/internal/command/wiki.go"]).cli, true);
  assert.equal(classifyChanges(["gdg-lib/src/acl/agent.ts"]).cli, true);
  assert.equal(classifyChanges(["gdg-lib/scripts/build-acl.mjs"]).cli, true);
  assert.equal(classifyChanges(["scripts/run-go-ci.mjs"]).cli, true);
  assert.equal(classifyChanges(["docs/operations.md"]).cli, false);
  assert.equal(classifyChanges(["pnpm-lock.yaml"]).cli, true);
});

test("gates script-tests on workflow scripts and agent-host components", () => {
  assert.equal(classifyChanges([".github/scripts/gdg-agent-layout.test.mjs"]).scriptTests, true);
  assert.equal(classifyChanges(["scripts/install-gdg-agent-host.sh"]).scriptTests, true);
  assert.equal(classifyChanges(["agent-host/config/permissions.json"]).scriptTests, true);
  assert.equal(classifyChanges(["agents-index/src/proxy.ts"]).scriptTests, true);
  assert.equal(classifyChanges(["cli/internal/wiki/hooks/acl-gate.ts"]).scriptTests, true);
  assert.equal(classifyChanges(["wiki/app/routes/home.tsx"]).scriptTests, false);
  assert.equal(classifyChanges(["docs/operations.md"]).scriptTests, false);
  assert.equal(classifyChanges(["accounts/src/index.ts"]).scriptTests, false);
  assert.equal(classifyChanges(["scripts/check-ui-conventions.mjs"]).scriptTests, true);
  assert.equal(classifyChanges(["scripts/run-ci.mjs"]).scriptTests, true);
  assert.equal(classifyChanges(["scripts/run-go-ci.mjs"]).scriptTests, true);
  assert.equal(classifyChanges(["gdg-lib/scripts/build-acl.mjs"]).scriptTests, true);
  assert.equal(
    classifyChanges(["wiki/tests/architecture/ui-conventions-baseline.json"]).scriptTests,
    true,
  );
});

test("selects nested workspace @gdgjp/langfuse-forwarder on agent-host/langfuse-forwarder changes", () => {
  const result = classifyChanges(["agent-host/langfuse-forwarder/src/index.ts"]);
  assert.deepEqual(result.ci, ["@gdgjp/langfuse-forwarder"]);
  assert.deepEqual(result.build, []);
  assert.deepEqual(result.e2e, []);
});

test("agent-host non-forwarder changes do not select @gdgjp/langfuse-forwarder", () => {
  const result = classifyChanges(["agent-host/workspace/AGENTS.md"]);
  assert.deepEqual(result.ci, []);
  assert.equal(result.scriptTests, true);
  assert.equal(result.agentHostWorkspace, true);
});

test("detects agent-host/workspace changes with agentHostWorkspace predicate", () => {
  assert.equal(
    classifyChanges(["agent-host/workspace/.agents/skills/wiki-ingest/SKILL.md"])
      .agentHostWorkspace,
    true,
  );
  assert.equal(classifyChanges(["agent-host/config/cli-config.json"]).agentHostWorkspace, false);
  assert.equal(classifyChanges(["wiki/app/routes/home.tsx"]).agentHostWorkspace, false);
});

test("GDG UI changes validate and deploy its consumers", () => {
  const result = classifyChanges(["design-system/src/styles/tokens.css"]);
  assert.deepEqual(result.ci, [
    "@gdgjp/design-system",
    "@gdgjp/accounts",
    "@gdgjp/tinyurl",
    "@gdgjp/wiki",
    "@gdgjp/img",
    "@gdgjp/scheduler",
    "@gdgjp/pay",
    "@gdgjp/roster",
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
  ]);
  assert.deepEqual(
    result.deploy.map(({ app }) => app),
    ["accounts", "tinyurl", "wiki", "img", "scheduler", "pay", "roster"],
  );
});

test("UI gitlink updates select the same targets as library source changes", () => {
  assert.deepEqual(
    classifyChanges(["design-system"]),
    classifyChanges(["design-system/README.md"]),
  );
});
