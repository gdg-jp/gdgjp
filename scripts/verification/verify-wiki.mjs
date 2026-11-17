#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let serve = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--source" && args[index + 1]) source = resolve(args[++index]);
  else if (args[index] === "--serve") serve = true;
  else if (args[index] !== "--doctor") throw new Error(`Unknown argument: ${args[index]}`);
}
const configuredNode =
  process.env.GDG_CI_NODE ??
  spawnSync("git", ["config", "--local", "--get", "gdgjp.ciNode"], {
    cwd: source,
    encoding: "utf8",
  }).stdout?.trim();
const runtime = configuredNode || process.execPath;
const environment = {
  PATH: `${dirname(runtime)}:${process.env.PATH}`,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  CI: "1",
  CLOUDFLARE_ENV: "e2e",
  WIKI_E2E_PERSIST_TO: ".wrangler/e2e-state",
  WIKI_E2E_SESSION_SECRET: "pstack-wiki-local-test-session-secret",
  WIKI_E2E_ISSUER: "http://localhost:6173",
  WRANGLER_SEND_METRICS: "false",
};
for (const name of [
  "package.json",
  "pnpm-workspace.yaml",
  "node_modules",
  "apps/wiki/node_modules",
  "packages/design-system/package.json",
  "packages/gdg-lib/package.json",
]) {
  if (!existsSync(join(source, name)))
    throw new Error(`Missing ${name}; initialize submodules and run pnpm install`);
}
if (!existsSync(runtime)) throw new Error(`Configured Node runtime is missing: ${runtime}`);
if (spawnSync("pnpm", ["--version"], { env: environment }).status !== 0)
  throw new Error("pnpm is unavailable");
for (const host of ["127.0.0.1", "::1"]) {
  await new Promise((done, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRNOTAVAIL") done();
      else
        reject(
          new Error(
            `Port 6177 on ${host} is occupied or unavailable; do not reuse or stop its owner`,
          ),
        );
    });
    server.listen(6177, host, () => server.close(done));
  });
}
console.log("Doctor passed: source, installed dependencies, Node, pnpm, and port 6177 are ready.");
if (serve) {
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = join(source, "local_data/pstack/wiki", runId);
  mkdirSync(evidence, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "gdgjp-verify-wiki-"));
  const app = join(scratch, "apps/wiki");
  const excluded = new Set([
    ".git",
    "node_modules",
    ".wrangler",
    ".react-router",
    "build",
    "dist",
    "coverage",
    "test-results",
    "playwright-report",
    "storage-state",
    ".turbo",
    ".env",
    ".env.local",
  ]);
  let log = "";
  let child;
  let stopping = false;
  let exitCode = 1;
  const stop = () => {
    stopping = true;
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  function copyTree(name) {
    cpSync(join(source, name), join(scratch, name), {
      recursive: true,
      dereference: true,
      filter: (path) => {
        const leaf = path.split("/").at(-1);
        return !excluded.has(leaf) && !leaf.startsWith(".dev.vars") && !leaf.startsWith(".env.");
      },
    });
  }
  function linkDependencies(name) {
    const from = join(source, name, "node_modules");
    const to = join(scratch, name, "node_modules");
    if (!existsSync(from)) return;
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name.startsWith(".vite")) continue;
      if (entry.name === "@gdgjp") {
        mkdirSync(join(to, entry.name), { recursive: true });
        for (const dependency of readdirSync(join(from, entry.name))) {
          const local = join(scratch, "packages", dependency);
          symlinkSync(
            existsSync(local) ? local : realpathSync(join(from, entry.name, dependency)),
            join(to, entry.name, dependency),
          );
        }
      } else symlinkSync(realpathSync(join(from, entry.name)), join(to, entry.name));
    }
  }
  function run(cwd, command, commandArgs, env = environment) {
    const result = spawnSync(command, commandArgs, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    log += result.stdout ?? "";
    log += result.stderr ?? "";
    if (result.status !== 0)
      throw new Error(
        `Failed ${command} ${commandArgs.join(" ")}: ${result.stderr ?? result.error}`,
      );
  }
  try {
    for (const name of [
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "apps/wiki",
      "packages/gdg-lib",
      "packages/design-system",
      "scripts/run-e2e-dev.mjs",
      "docs",
    ])
      copyTree(name);
    for (const name of ["", "apps/wiki", "packages/gdg-lib", "packages/design-system"])
      linkDependencies(name);
    run(join(scratch, "packages/design-system"), runtime, ["scripts/build.mjs", "--no-check"]);
    run(app, "pnpm", [
      "exec",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      ".wrangler/e2e-state",
    ]);
    run(app, runtime, ["tests/e2e/setup.ts"]);
    writeFileSync(
      join(app, ".dev.vars.e2e"),
      [
        "RP_SESSION_SECRET=pstack-wiki-local-test-session-secret",
        "IDP_CLIENT_SECRET=pstack-wiki-local-test-client-secret",
        "APP_URL=http://localhost:6177",
        "ACCOUNTS_URL=http://localhost:6173",
        "IDP_URL=http://localhost:6173",
        "ENVIRONMENT=development",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    run(app, "pnpm", ["build"], { ...environment, CLOUDFLARE_ENV: undefined });
    const state = JSON.parse(
      readFileSync(join(app, "tests/e2e/storage-state/author.json"), "utf8"),
    );
    const cookie = state.cookies[0];
    const manifest = {
      source,
      scratch,
      runtime,
      baseUrl: "http://localhost:6177",
      seededPageUrl: "http://localhost:6177/wiki/e2e-test-page",
      authFixtures: Object.fromEntries(
        ["author", "member", "admin"].map((name) => [
          name,
          join(app, `tests/e2e/storage-state/${name}.json`),
        ]),
      ),
      browserDriver: "orca browser",
      evidence,
    };
    writeFileSync(join(evidence, "run.json"), JSON.stringify(manifest, null, 2));
    console.log(`Evidence: ${evidence}`);
    child = spawn(runtime, ["../../scripts/run-e2e-dev.mjs", "6177"], {
      cwd: app,
      env: { ...environment, GDG_E2E_BUILT: "wiki" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = new Promise((done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done(code ?? 1));
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (data) => {
        log += data;
        process.stdout.write(data);
      });
    const deadline = Date.now() + 180_000;
    while (true) {
      if (stopping || child.exitCode !== null) throw new Error("Server stopped before readiness");
      try {
        const response = await fetch("http://localhost:6177/og-image.png", {
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          await response.arrayBuffer();
          break;
        }
      } catch {}
      if (Date.now() > deadline)
        throw new Error("Wiki did not reach static readiness within 180 seconds");
      await new Promise((done) => setTimeout(done, 300));
    }
    const response = await fetch(manifest.seededPageUrl, {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    writeFileSync(join(evidence, "seeded-page.html"), body);
    if (!response.ok || !body.includes("E2E Test Page"))
      throw new Error(`Seeded author page not usable: HTTP ${response.status}`);
    console.log(`READY ${JSON.stringify({ ...manifest, seededPageStatus: response.status })}`);
    writeFileSync(
      join(evidence, "ready.json"),
      JSON.stringify({ ...manifest, seededPageStatus: response.status }, null, 2),
    );
    exitCode = await exited;
    if (stopping) exitCode = 0;
  } catch (error) {
    log += `\n${error.stack}\n`;
    throw error;
  } finally {
    stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    rmSync(scratch, { recursive: true, force: true });
    writeFileSync(join(evidence, "server.log"), log);
    writeFileSync(
      join(evidence, "result.json"),
      JSON.stringify({ exitCode, scratchRemoved: !existsSync(scratch) }, null, 2),
    );
    console.log(`Cleanup complete; evidence retained at ${evidence}`);
  }
  process.exitCode = exitCode;
}
