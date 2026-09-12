import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployWorkflow = await readFile(new URL("../workflows/deploy.yml", import.meta.url), "utf8");

test("Cloudflare pipelines invoke the package deploy script unambiguously", () => {
  const cloudflareWorkspaces = [
    "accounts",
    "tinyurl",
    "wiki",
    "img",
    "scheduler",
    "sns",
    "ost",
    "roster",
    "website",
  ];

  for (const workspace of cloudflareWorkspaces) {
    assert.match(deployWorkflow, new RegExp(`pnpm --filter @gdgjp/${workspace} run deploy`));
  }
  assert.doesNotMatch(deployWorkflow, /pnpm --filter @gdgjp\/[^ ]+ deploy$/m);
});

test("deploy keeps application pipelines inside a parallel step", () => {
  assert.match(deployWorkflow, / {6}- parallel:\n/);
  const deployJob = deployWorkflow.slice(deployWorkflow.indexOf("  deploy:\n"));
  assert.match(
    deployJob,
    /pnpm install --frozen-lockfile\n[\s\S]*?- name: Build shared UI dependency\n\s+run: pnpm --filter @gdgjp\/ui build\n\s+- parallel:/,
  );
  assert.match(
    deployWorkflow,
    /pnpm --filter @gdgjp\/accounts build\n\s+pnpm --filter @gdgjp\/accounts run deploy\n\s+pnpm --filter @gdgjp\/accounts migrate:remote/,
  );
});
