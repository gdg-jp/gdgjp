import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runGwsMediator } from "./gws.ts";

const gwsScript = join(dirname(fileURLToPath(import.meta.url)), "gws.ts");

const savedEnv = { ...process.env };

/** runGwsMediator mutates process.env-derived state only via the child's copy,
 * but the test itself sets ambient vars (HOME, TOKEN, ...) on process.env to
 * drive it — restore those between tests so they don't leak. */
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

/**
 * A fake gws-bin that reports its own argv/cwd/env to a file. Its own stdout
 * is not captured here: runGwsMediator always runs the real binary with
 * stdio: "inherit" (matching production), so observations are written out via
 * a path the test controls instead of read back from process output.
 */
function writeStubGwsBin(dir: string, observedPath: string): string {
  const path = join(dir, "gws-bin");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({`,
      "  argv: process.argv.slice(2),",
      "  cwd: process.cwd(),",
      "  env: {",
      "    GOOGLE_WORKSPACE_CLI_TOKEN: process.env.GOOGLE_WORKSPACE_CLI_TOKEN ?? null,",
      "    GOOGLE_WORKSPACE_CLI_CONFIG_DIR: process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ?? null,",
      "    GOOGLE_WORKSPACE_CLI_CLIENT_ID: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID ?? null,",
      "    GOOGLE_WORKSPACE_CLI_CLIENT_SECRET: process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET ?? null,",
      "    GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE: process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE ?? null,",
      "  },",
      "}));",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(path, 0o755);
  return path;
}

function freshHome(entries: string[]): string {
  const home = mkdtempSync(join(tmpdir(), "gdg-gws-home-"));
  const cursorDir = join(home, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(
    join(cursorDir, "permissions.json"),
    JSON.stringify({ gwsAllowlist: entries }),
    "utf8",
  );
  return home;
}

/** Plants credentials at gws's real fallback locations (~/.config/gws/credentials.json and a
 * cwd-loaded .env), per the plan's requirement that the mediator ignore both. */
function plantRealFallbackCredentials(home: string): void {
  const gwsConfigDir = join(home, ".config", "gws");
  mkdirSync(gwsConfigDir, { recursive: true });
  writeFileSync(
    join(gwsConfigDir, "credentials.json"),
    JSON.stringify({ refresh_token: "should-never-be-used" }),
    "utf8",
  );
  writeFileSync(join(home, ".env"), "GOOGLE_WORKSPACE_CLI_TOKEN=should-never-be-used\n", "utf8");
}

function setAmbientEnv(opts: { home: string; token?: string }): void {
  process.env.HOME = opts.home;
  process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID = "ambient-client-id";
  process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET = "ambient-secret";
  process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = "/should/not/leak.json";
  if (opts.token) process.env.GOOGLE_WORKSPACE_CLI_TOKEN = opts.token;
  // process.env stringifies assigned values (unlike a plain object), so an
  // absent token must be removed with delete, not `= undefined`.
  // biome-ignore lint/performance/noDelete: `= undefined` would set the literal string "undefined" on process.env
  else delete process.env.GOOGLE_WORKSPACE_CLI_TOKEN;
}

describe("gws.ts", () => {
  it("the real CLI entrypoint always targets the fixed /opt/gdg-agent/bin/gws-bin, ignoring any env override", () => {
    const home = freshHome(["drive files list"]);
    const result = spawnSync(process.execPath, [gwsScript, "drive", "files", "list"], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        GOOGLE_WORKSPACE_CLI_TOKEN: "vended-token",
        GDG_GWS_BIN_PATH: "/definitely/not/used",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\/opt\/gdg-agent\/bin\/gws-bin/);
    assert.doesNotMatch(
      result.stderr,
      /at Object|at Module|\.js:\d+:\d+\)/,
      "must be a clean message, not a stack trace",
    );
  });

  it("runGwsMediator only ever spawns the caller-supplied binPath (no environment override)", () => {
    const home = freshHome(["drive files list"]);
    setAmbientEnv({ home, token: "vended-token" });
    process.env.GDG_GWS_BIN_PATH = "/definitely/not/used";
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    const status = runGwsMediator(["drive", "files", "list"], gwsBin);
    assert.equal(status, 0);
    assert.ok(
      existsSync(observedPath),
      "the real gws-bin argument, not GDG_GWS_BIN_PATH, must run",
    );
  });

  it("execs gws-bin with a fresh config dir, the vended token, and cleared credential env", () => {
    const home = freshHome(["drive files list", "drive files get"]);
    setAmbientEnv({ home, token: "vended-token" });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    const status = runGwsMediator(["drive", "files", "list"], gwsBin);
    assert.equal(status, 0);
    const payload = JSON.parse(readFileSync(observedPath, "utf8"));
    assert.deepEqual(payload.argv, ["drive", "files", "list"]);
    assert.equal(payload.env.GOOGLE_WORKSPACE_CLI_TOKEN, "vended-token");
    assert.ok(payload.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, "config dir must be set");
    assert.ok(
      !payload.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR.startsWith(home),
      "config dir must not live under the slot HOME",
    );
    assert.equal(
      realpathSync(payload.cwd),
      realpathSync(payload.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR),
    );
    assert.equal(payload.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID, null);
    assert.equal(payload.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET, null);
    assert.equal(payload.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE, null);
  });

  it("ignores credentials planted at gws's real fallback locations ($HOME/.config/gws and $HOME/.env)", () => {
    const home = freshHome(["drive files list"]);
    plantRealFallbackCredentials(home);
    setAmbientEnv({ home, token: "vended-token" });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    const status = runGwsMediator(["drive", "files", "list"], gwsBin);
    assert.equal(status, 0);
    const payload = JSON.parse(readFileSync(observedPath, "utf8"));
    const configDir = payload.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR;
    assert.notEqual(configDir, join(home, ".config", "gws"));
    assert.notEqual(configDir, home);
    assert.equal(existsSync(join(configDir, "credentials.json")), false);
    assert.equal(existsSync(join(configDir, ".env")), false);
    assert.equal(
      realpathSync(payload.cwd),
      realpathSync(configDir),
      "gws-bin's cwd (its .env search root) is the fresh config dir, not $HOME",
    );
    assert.equal(payload.env.GOOGLE_WORKSPACE_CLI_TOKEN, "vended-token");
  });

  it("fails closed when no token is available, even with an approved argv and real fallback credentials present", () => {
    const home = freshHome(["drive files list"]);
    plantRealFallbackCredentials(home);
    setAmbientEnv({ home });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    assert.throws(() => runGwsMediator(["drive", "files", "list"], gwsBin), /gws:.*token/i);
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });

  it("fails closed on an unapproved argv without invoking gws-bin", () => {
    const home = freshHome(["drive files list"]);
    setAmbientEnv({ home, token: "vended-token" });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    assert.throws(() => runGwsMediator(["drive", "files", "emptyTrash"], gwsBin));
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });

  it("fails closed on --upload without invoking gws-bin", () => {
    const home = freshHome(["drive files list"]);
    setAmbientEnv({ home, token: "vended-token" });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    assert.throws(
      () => runGwsMediator(["drive", "files", "list", "--upload", "/etc/passwd"], gwsBin),
      /--upload/,
    );
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });
});
