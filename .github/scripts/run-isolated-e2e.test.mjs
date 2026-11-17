import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { assertPortsAvailable } from "../../scripts/run-isolated-e2e.mjs";
import { createWorkspaceSnapshot } from "../../scripts/verification/workspace-snapshot.mjs";

const runner = fileURLToPath(new URL("../../scripts/run-isolated-e2e.mjs", import.meta.url));

function fixture(t, control = {}) {
  const directory = mkdtempSync(join(tmpdir(), "isolated-e2e-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const bin = join(directory, "bin");
  const capture = join(directory, "capture.json");
  mkdirSync(source);
  mkdirSync(bin);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init", "--quiet");
  const put = (file, value) => {
    const path = join(source, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  };
  put(".gitignore", "node_modules/\nlocal_data/\n.wrangler/\n");
  put("package.json", { name: "fixture", private: true, packageManager: "pnpm@9.15.0" });
  put("pnpm-workspace.yaml", "packages:\n  - apps/*\n  - packages/*\n");
  put("apps/check/package.json", {
    name: "@fixture/check",
    scripts: { "test:e2e": "playwright test" },
  });
  put("apps/check/source.ts", "export const value = 1;\n");
  put("apps/check/.dev.vars", "REAL_SECRET=keep-in-source\n");
  put("apps/check/.env.production", "EXTERNAL_SECRET=keep-in-source\n");
  put("apps/check/.wrangler/developer-state", "do not change");
  writeFileSync(
    join(bin, "pnpm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const control = ${JSON.stringify(control)};
const cwd = process.cwd();
const reportDirectory = path.join(cwd, "apps/check", "test-results");
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(path.join(reportDirectory, "failure.txt"), "retained evidence");
if (!control.missingReport) {
  const json = path.join(cwd, "apps/check", process.env.PLAYWRIGHT_JSON_OUTPUT_NAME);
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(json, JSON.stringify({ stats: { expected: 1, unexpected: 0, skipped: 2, flaky: 0 } }));
}
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ cwd, args: process.argv.slice(2), env: process.env,
  copiedSecret: fs.existsSync(path.join(cwd, "apps/check/.dev.vars")), copiedEnv: fs.existsSync(path.join(cwd, "apps/check/.env.production")),
  copiedState: fs.existsSync(path.join(cwd, "apps/check/.wrangler/developer-state")),
  registryExists: fs.existsSync(process.env.MINIFLARE_REGISTRY_PATH) }));
if (control.wait) setInterval(() => {}, 1000);
else process.exit(control.exit ?? 0);
`,
  );
  chmodSync(join(bin, "pnpm"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    REAL_SECRET: "must-not-inherit",
    GDG_E2E_BUILT: "developer-build",
  };
  const read = () => JSON.parse(readFileSync(capture, "utf8"));
  const evidence = () => {
    const directories = readdirSync(join(source, "local_data/pstack/e2e"));
    return join(source, "local_data/pstack/e2e", directories.at(-1));
  };
  return {
    directory,
    source,
    capture,
    env,
    put,
    git,
    read,
    evidence,
    run: (args = []) =>
      spawnSync(process.execPath, [runner, "--source", source, ...args], { env, encoding: "utf8" }),
  };
}

test("snapshots working files, excludes secrets/state, and relinks local workspace dependencies", (t) => {
  const f = fixture(t);
  f.put("packages/lib/package.json", { name: "@fixture/lib" });
  f.put("packages/lib/index.ts", "export const value = 1;\n");
  f.git("add", "apps/check/source.ts", "apps/check/.dev.vars", "apps/check/.env.production");
  f.put("apps/check/source.ts", "export const value = 2;\n");
  mkdirSync(join(f.source, "apps/check/node_modules/@fixture"), { recursive: true });
  symlinkSync(
    join(f.source, "packages/lib"),
    join(f.source, "apps/check/node_modules/@fixture/lib"),
  );
  const snapshot = createWorkspaceSnapshot(f.source);
  try {
    assert.equal(
      readFileSync(join(snapshot.root, "apps/check/source.ts"), "utf8"),
      "export const value = 2;\n",
    );
    assert.equal(existsSync(join(snapshot.root, "apps/check/.dev.vars")), false);
    assert.equal(existsSync(join(snapshot.root, "apps/check/.env.production")), false);
    assert.equal(existsSync(join(snapshot.root, "apps/check/.wrangler")), false);
    assert.equal(
      realpathSync(join(snapshot.root, "apps/check/node_modules/@fixture/lib")),
      join(snapshot.root, "packages/lib"),
    );
    assert.match(snapshot.hashes["apps/check/source.ts"], /^[a-f0-9]{64}$/);
    assert.equal(snapshot.hashes["apps/check/.dev.vars"], undefined);
  } finally {
    snapshot.dispose();
  }
  assert.equal(existsSync(snapshot.root), false);
  assert.equal(
    readFileSync(join(f.source, "apps/check/.dev.vars"), "utf8"),
    "REAL_SECRET=keep-in-source\n",
  );
});

test("keeps submodule revision metadata independent of the source git directory", (t) => {
  const f = fixture(t);
  f.put("skills/recipe.txt", "recipe\n");
  const revision = "1234567890123456789012345678901234567890";
  spawnSync("git", ["init", "--quiet"], { cwd: join(f.source, "skills") });
  writeFileSync(join(f.source, "skills/.git/HEAD"), `${revision}\n`);
  f.git("add", "skills");
  const snapshot = createWorkspaceSnapshot(f.source);
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: join(snapshot.root, "skills"),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), revision);
    assert.equal(readFileSync(join(snapshot.root, "skills/recipe.txt"), "utf8"), "recipe\n");
    assert.notEqual(
      realpathSync(join(snapshot.root, "skills/.git")),
      realpathSync(join(f.source, "skills/.git")),
    );
  } finally {
    snapshot.dispose();
  }
});

test("runs the selected E2E command with fresh state and retains its reports after cleanup", (t) => {
  const f = fixture(t);
  const result = f.run(["--workspace", "@fixture/check", "--", "--grep", "journey"]);
  assert.equal(result.status, 0, result.stderr);
  const captured = f.read();
  assert.deepEqual(captured.args, [
    "exec",
    "turbo",
    "test:e2e",
    "--concurrency=1",
    "--continue=always",
    "--env-mode=loose",
    "--filter=@fixture/check",
    "--",
    "--grep",
    "journey",
    "--reporter=dot,json",
  ]);
  assert.equal(captured.env.CI, "true");
  assert.equal(captured.env.REAL_SECRET, undefined);
  assert.equal(captured.env.GDG_E2E_BUILT, "");
  assert.equal(captured.registryExists, true);
  assert.equal(captured.copiedSecret, false);
  assert.equal(captured.copiedEnv, false);
  assert.equal(captured.copiedState, false);
  assert.equal(existsSync(captured.cwd), false);
  const evidence = f.evidence();
  const report = JSON.parse(readFileSync(join(evidence, "result.json"), "utf8"));
  assert.equal(report.status, "VERIFIED");
  assert.equal(report.scratchCleaned, true);
  assert.deepEqual(report.reports[0].counts, { passed: 1, failed: 0, skipped: 2, flaky: 0 });
  assert.equal(
    readFileSync(join(evidence, "apps/check/test-results/failure.txt"), "utf8"),
    "retained evidence",
  );
  assert.equal(existsSync(join(evidence, "apps/check/.turbo/ci-playwright.json")), true);
  assert.match(result.stdout, /isolated-e2e-result=.*result\.json/);
  assert.equal(
    readFileSync(join(f.source, "apps/check/.wrangler/developer-state"), "utf8"),
    "do not change",
  );
});

test("propagates a failing child status without deleting developer state", (t) => {
  const f = fixture(t, { exit: 17 });
  assert.equal(f.run().status, 17);
  const report = JSON.parse(readFileSync(join(f.evidence(), "result.json"), "utf8"));
  assert.equal(report.exitCode, 17);
  assert.equal(report.status, "NOT VERIFIED");
  assert.equal(report.scratchCleaned, true);
  assert.equal(existsSync(join(f.source, "apps/check/.wrangler/developer-state")), true);
});

test("fails closed when a successful child produces no browser proof", (t) => {
  const f = fixture(t, { missingReport: true });
  assert.equal(f.run().status, 1);
  const report = JSON.parse(readFileSync(join(f.evidence(), "result.json"), "utf8"));
  assert.equal(report.reports[0].counts, null);
  assert.equal(report.status, "NOT VERIFIED");
});

test("always includes machine-readable browser proof when callers choose another reporter", (t) => {
  const f = fixture(t);
  assert.equal(f.run(["--", "--reporter=dot"]).status, 0);
  assert.equal(f.read().args.at(-1), "--reporter=dot,json");
  assert.equal(f.run(["--", "--reporter", "github"]).status, 0);
  assert.deepEqual(f.read().args.slice(-2), ["--reporter", "github,json"]);
});

test("refuses an occupied E2E port without stopping its owner", async (t) => {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  t.after(() => new Promise((done) => server.close(done)));
  await assert.rejects(assertPortsAvailable([server.address().port]), /occupied/);
  assert.equal(server.listening, true);
});

test("forwards termination to its owned child and retains interrupted evidence", async (t) => {
  const f = fixture(t, { wait: true });
  const child = spawn(process.execPath, [runner, "--source", f.source], {
    env: f.env,
    stdio: "ignore",
  });
  const ended = new Promise((done) => child.once("close", (code) => done(code)));
  const deadline = Date.now() + 10_000;
  while (!existsSync(f.capture) && Date.now() < deadline)
    await new Promise((done) => setTimeout(done, 25));
  assert.equal(existsSync(f.capture), true);
  const scratch = f.read().cwd;
  child.kill("SIGTERM");
  assert.equal(await ended, 143);
  assert.equal(existsSync(scratch), false);
  const report = JSON.parse(readFileSync(join(f.evidence(), "result.json"), "utf8"));
  assert.equal(report.signal, "SIGTERM");
  assert.equal(report.status, "NOT VERIFIED");
  assert.equal(report.scratchCleaned, true);
});
