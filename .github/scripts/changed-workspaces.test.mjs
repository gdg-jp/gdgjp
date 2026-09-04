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
      "website",
      "agents",
    ],
  );
});

test("fans common configuration changes out to every target", () => {
  const result = classifyChanges(["pnpm-lock.yaml"]);

  assert.equal(result.ci.length, 15);
  assert.equal(result.build.length, 13);
  assert.equal(result.deploy.length, 12);
  assert.equal(result.openapi, true);
});

test("treats workflow and detector changes as global for their consumers", () => {
  const ci = classifyChanges([".github/workflows/ci.yml"]);
  const deploy = classifyChanges([".github/workflows/deploy.yml"]);
  const detector = classifyChanges([".github/scripts/changed-workspaces.mjs"]);

  assert.equal(ci.ci.length, 15);
  assert.equal(ci.deploy.length, 0);
  assert.equal(deploy.ci.length, 0);
  assert.equal(deploy.deploy.length, 12);
  assert.equal(detector.ci.length, 15);
  assert.equal(detector.deploy.length, 12);
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
  assert.equal(result.ci.length, 15);
  assert.equal(result.deploy.length, 12);
  assert.equal(result.lint, true);
  assert.equal(result.cli, true);
});

test("gates the CLI Go job on cli/ changes", () => {
  assert.equal(classifyChanges(["cli/internal/command/wiki.go"]).cli, true);
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
});
