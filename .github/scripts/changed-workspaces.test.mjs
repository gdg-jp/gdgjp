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

  assert.equal(result.ci.length, 13);
  assert.equal(result.build.length, 12);
  assert.equal(result.deploy.length, 11);
  assert.equal(result.openapi, true);
});

test("treats workflow and detector changes as global for their consumers", () => {
  const ci = classifyChanges([".github/workflows/ci.yml"]);
  const deploy = classifyChanges([".github/workflows/deploy.yml"]);
  const detector = classifyChanges([".github/scripts/changed-workspaces.mjs"]);

  assert.equal(ci.ci.length, 13);
  assert.equal(ci.deploy.length, 0);
  assert.equal(deploy.ci.length, 0);
  assert.equal(deploy.deploy.length, 11);
  assert.equal(detector.ci.length, 13);
  assert.equal(detector.deploy.length, 11);
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
  assert.equal(result.ci.length, 13);
  assert.equal(result.deploy.length, 11);
  assert.equal(result.lint, true);
  assert.equal(result.cli, true);
});

test("gates the CLI Go job on cli/ changes", () => {
  assert.equal(classifyChanges(["cli/internal/command/wiki.go"]).cli, true);
  assert.equal(classifyChanges(["docs/operations.md"]).cli, false);
  assert.equal(classifyChanges(["pnpm-lock.yaml"]).cli, true);
});
