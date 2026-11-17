import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../../apps/pr/e2e/run.mjs", import.meta.url));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pr-e2e-wrapper-test-"));
  const capture = join(directory, "capture.json");
  const existing = join(directory, "developer-state");
  mkdirSync(existing);
  writeFileSync(join(existing, "keep"), "developer state");
  const executable = join(directory, "pnpm");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const state = process.env.PR_E2E_PERSIST_TO;
fs.writeFileSync(path.join(state, "child-owned"), "fixture");
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({
  state,
  stateExists: fs.existsSync(state),
  miniflareRegistry: process.env.MINIFLARE_REGISTRY_PATH,
  wranglerRegistry: process.env.WRANGLER_REGISTRY_PATH,
  registryExists: fs.existsSync(process.env.MINIFLARE_REGISTRY_PATH),
  realServices: process.env.PR_REAL_SERVICES,
  args: process.argv.slice(2),
}));
if (process.env.WAIT_FOR_SIGNAL) setInterval(() => {}, 1000);
else process.exit(Number(process.env.CHILD_EXIT ?? 0));
`,
  );
  chmodSync(executable, 0o755);
  const env = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    CAPTURE: capture,
    PR_E2E_PERSIST_TO: existing,
    MINIFLARE_REGISTRY_PATH: existing,
    WRANGLER_REGISTRY_PATH: existing,
    PR_REAL_SERVICES: "1",
  };
  return {
    directory,
    capture,
    existing,
    env,
    run: (args = [], extra = {}) =>
      spawnSync(process.execPath, [runner, ...args], {
        cwd: directory,
        env: { ...env, ...extra },
        encoding: "utf8",
      }),
    read: () => JSON.parse(readFileSync(capture, "utf8")),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("PR E2E owns fresh state and mock registry for each run, forwards arguments, and preserves developer data", () => {
  const f = fixture();
  try {
    const result = f.run(["connpass.spec.ts", "--reporter=dot"]);
    assert.equal(result.status, 0, result.stderr);
    const first = f.read();
    assert.deepEqual(first.args, [
      "exec",
      "playwright",
      "test",
      "connpass.spec.ts",
      "--reporter=dot",
    ]);
    assert.equal(first.stateExists, true);
    assert.equal(first.registryExists, true);
    assert.notEqual(first.state, f.existing);
    assert.equal(first.miniflareRegistry, join(first.state, "registry"));
    assert.equal(first.wranglerRegistry, first.miniflareRegistry);
    assert.equal(first.realServices, "");
    assert.equal(existsSync(first.state), false);
    assert.equal(readFileSync(join(f.existing, "keep"), "utf8"), "developer state");
    assert.equal(f.run().status, 0);
    const second = f.read();
    assert.notEqual(second.state, first.state);
    assert.equal(existsSync(second.state), false);
  } finally {
    f.cleanup();
  }
});

test("PR E2E propagates child failure and still removes only its owned persistence", () => {
  const f = fixture();
  try {
    const result = f.run([], { CHILD_EXIT: "17" });
    assert.equal(result.status, 17);
    assert.equal(existsSync(f.read().state), false);
    assert.equal(existsSync(join(f.existing, "keep")), true);
  } finally {
    f.cleanup();
  }
});

test(
  "PR E2E forwards termination to its child and cleans its persistence",
  { timeout: 10000 },
  async () => {
    const f = fixture();
    const child = spawn(process.execPath, [runner], {
      cwd: f.directory,
      env: { ...f.env, WAIT_FOR_SIGNAL: "1" },
      stdio: "pipe",
    });
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
      while (!existsSync(f.capture)) {
        if (child.exitCode !== null)
          throw new Error("Wrapper exited before fixture child was ready");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const record = f.read();
      child.kill("SIGTERM");
      assert.deepEqual(await closed, { code: 143, signal: null });
      assert.equal(existsSync(record.state), false);
      assert.equal(existsSync(join(f.existing, "keep")), true);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await closed;
      f.cleanup();
    }
  },
);
