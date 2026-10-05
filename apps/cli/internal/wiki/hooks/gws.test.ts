import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runGwsMediator } from "./gws.ts";

const gwsScript = join(dirname(fileURLToPath(import.meta.url)), "gws.ts");

const savedEnv = { ...process.env };

/** runGwsMediator mutates process.env-derived state only via the child's copy,
 * but the test itself sets ambient vars (HOME, XANGI_*, ...) on process.env to
 * drive it — restore those between tests so they don't leak. */
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

const AUTHZ_NONCE = "test-nonce";

type AuthzStubOptions = {
  /** omit entirely to leave gdgSub out of the /resolve body (malformed/missing case) */
  gdgSub?: string | null;
  resolveBody?: unknown;
  workspaceStatus?: number;
  workspaceBody?: unknown;
};

type RecordedRequest = { pathname: string; method: string; searchParams: URLSearchParams };

/** Fakes the per-slot authz Unix socket that resolveAuthz()/resolveWorkspaceToken() call. */
function startAuthzStub(opts: AuthzStubOptions = {}): Promise<{
  socketPath: string;
  requests: RecordedRequest[];
  close: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "gdg-gws-authz-"));
  const socketPath = join(dir, "authz.sock");
  const requests: RecordedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push({
      pathname: url.pathname,
      method: req.method ?? "",
      searchParams: url.searchParams,
    });
    if (url.pathname === "/resolve") {
      const resolveBody =
        opts.resolveBody ??
        ("gdgSub" in opts
          ? { classes: [], channelAudience: { kind: "private" }, gdgSub: opts.gdgSub }
          : { classes: [], channelAudience: { kind: "private" } });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(resolveBody));
      return;
    }
    if (url.pathname === "/workspace-token") {
      res.statusCode = opts.workspaceStatus ?? 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(opts.workspaceBody ?? { access_token: "vended-token" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        socketPath,
        requests,
        close: () => {
          server.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

/** Asserts the mediator's request carries only the nonce it was given — GET, no user/sub param. */
function assertNonceOnlyRequest(requests: RecordedRequest[], pathname: string): void {
  const req = requests.find((r) => r.pathname === pathname);
  assert.ok(req, `expected a request to ${pathname}`);
  assert.equal(req.method, "GET");
  assert.equal(req.searchParams.get("nonce"), AUTHZ_NONCE);
  assert.deepEqual(
    [...req.searchParams.keys()],
    ["nonce"],
    `${pathname} must carry only nonce, never a caller-supplied identity parameter`,
  );
}

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

function setAmbientEnv(opts: { home: string; socketPath?: string }): void {
  process.env.HOME = opts.home;
  process.env.GOOGLE_WORKSPACE_CLI_CLIENT_ID = "ambient-client-id";
  process.env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET = "ambient-secret";
  process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE = "/should/not/leak.json";
  if (opts.socketPath) {
    process.env.XANGI_AUTHZ_SOCKET = opts.socketPath;
    process.env.XANGI_AUTHZ_NONCE = AUTHZ_NONCE;
  } else {
    // biome-ignore lint/performance/noDelete: `= undefined` would set the literal string "undefined" on process.env
    delete process.env.XANGI_AUTHZ_SOCKET;
    // biome-ignore lint/performance/noDelete: `= undefined` would set the literal string "undefined" on process.env
    delete process.env.XANGI_AUTHZ_NONCE;
  }
  // biome-ignore lint/performance/noDelete: legacy Phase-2 stub var must never leak into resolveToken
  delete process.env.GOOGLE_WORKSPACE_CLI_TOKEN;
}

describe("gws.ts", () => {
  it("the real CLI entrypoint always targets the fixed /opt/gdg-agent/bin/gws-bin, ignoring any env override", async (t) => {
    // This assertion only holds hermetically when /opt/gdg-agent/bin/gws-bin is absent: spawning
    // gws.ts then fails at exec time with a message naming that fixed path. On a host where the
    // real binary is actually installed (e.g. a live agent-host production box), the spawn
    // succeeds and the child attempts real Google Workspace API calls instead, which is a
    // different (and non-hermetic) failure path this test can't assert on.
    if (existsSync("/opt/gdg-agent/bin/gws-bin")) {
      t.skip("requires a host without a real /opt/gdg-agent/bin/gws-bin installed");
      return;
    }
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({ gdgSub: "linked-user" });
    try {
      // spawnSync would block this process's event loop for the child's whole
      // lifetime, starving the in-process fake authz HTTP server it needs to
      // answer — use async spawn so both run concurrently, as production does.
      const result = await new Promise<{ status: number | null; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [gwsScript, "drive", "files", "list"], {
          env: {
            ...process.env,
            HOME: home,
            XANGI_AUTHZ_SOCKET: authz.socketPath,
            XANGI_AUTHZ_NONCE: AUTHZ_NONCE,
            GDG_GWS_BIN_PATH: "/definitely/not/used",
          },
        });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        child.on("close", (status) => resolve({ status, stderr }));
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /\/opt\/gdg-agent\/bin\/gws-bin/);
      assert.doesNotMatch(
        result.stderr,
        /at Object|at Module|\.js:\d+:\d+\)/,
        "must be a clean message, not a stack trace",
      );
    } finally {
      authz.close();
    }
  });

  it("runGwsMediator only ever spawns the caller-supplied binPath (no environment override)", async () => {
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({ gdgSub: "linked-user" });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      process.env.GDG_GWS_BIN_PATH = "/definitely/not/used";
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      const status = await runGwsMediator(["drive", "files", "list"], gwsBin);
      assert.equal(status, 0);
      assert.ok(
        existsSync(observedPath),
        "the real gws-bin argument, not GDG_GWS_BIN_PATH, must run",
      );
    } finally {
      authz.close();
    }
  });

  it("execs gws-bin with a fresh config dir, the vended token, and cleared credential env", async () => {
    const home = freshHome(["drive files list", "drive files get"]);
    const authz = await startAuthzStub({
      gdgSub: "linked-user",
      workspaceBody: { access_token: "vended-token" },
    });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      const status = await runGwsMediator(["drive", "files", "list"], gwsBin);
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
      assertNonceOnlyRequest(authz.requests, "/resolve");
      assertNonceOnlyRequest(authz.requests, "/workspace-token");
    } finally {
      authz.close();
    }
  });

  it("ignores credentials planted at gws's real fallback locations ($HOME/.config/gws and $HOME/.env)", async () => {
    const home = freshHome(["drive files list"]);
    plantRealFallbackCredentials(home);
    const authz = await startAuthzStub({ gdgSub: "linked-user" });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      const status = await runGwsMediator(["drive", "files", "list"], gwsBin);
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
    } finally {
      authz.close();
    }
  });

  it("fails closed with a clear message when the Discord invoker has no linked GDG account", async () => {
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({ gdgSub: null });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      await assert.rejects(
        () => runGwsMediator(["drive", "files", "list"], gwsBin),
        /connect Google Workspace first/,
      );
      assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
      assertNonceOnlyRequest(authz.requests, "/resolve");
      assert.equal(
        authz.requests.some((r) => r.pathname === "/workspace-token"),
        false,
        "an unlinked gdgSub must short-circuit before contacting /workspace-token",
      );
    } finally {
      authz.close();
    }
  });

  it("fails closed when /resolve omits gdgSub entirely", async () => {
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({});
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      await assert.rejects(
        () => runGwsMediator(["drive", "files", "list"], gwsBin),
        /authorization response is incomplete/,
      );
      assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
    } finally {
      authz.close();
    }
  });

  it("fails closed when /resolve returns a malformed (non-string, non-null) gdgSub", async () => {
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({
      resolveBody: { classes: [], channelAudience: { kind: "private" }, gdgSub: 12345 },
    });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      await assert.rejects(
        () => runGwsMediator(["drive", "files", "list"], gwsBin),
        /authorization response is incomplete/,
      );
      assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
    } finally {
      authz.close();
    }
  });

  it("fails closed when the authz server reports the linked account has no Workspace connection", async () => {
    const home = freshHome(["drive files list"]);
    const authz = await startAuthzStub({ gdgSub: "linked-user", workspaceStatus: 404 });
    try {
      setAmbientEnv({ home, socketPath: authz.socketPath });
      const observedPath = join(home, "observed.json");
      const gwsBin = writeStubGwsBin(home, observedPath);
      await assert.rejects(
        () => runGwsMediator(["drive", "files", "list"], gwsBin),
        /connect Google Workspace first/,
      );
      assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
      assertNonceOnlyRequest(authz.requests, "/workspace-token");
    } finally {
      authz.close();
    }
  });

  it("fails closed when no invocation authorization is present, even with an approved argv and real fallback credentials", async () => {
    const home = freshHome(["drive files list"]);
    plantRealFallbackCredentials(home);
    setAmbientEnv({ home });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    await assert.rejects(
      () => runGwsMediator(["drive", "files", "list"], gwsBin),
      /missing invocation authorization/,
    );
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });

  it("fails closed on an unapproved argv without invoking gws-bin or contacting the authz server", async () => {
    const home = freshHome(["drive files list"]);
    setAmbientEnv({ home });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    await assert.rejects(() => runGwsMediator(["drive", "files", "emptyTrash"], gwsBin));
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });

  it("fails closed on --upload without invoking gws-bin or contacting the authz server", async () => {
    const home = freshHome(["drive files list"]);
    setAmbientEnv({ home });
    const observedPath = join(home, "observed.json");
    const gwsBin = writeStubGwsBin(home, observedPath);
    await assert.rejects(
      () => runGwsMediator(["drive", "files", "list", "--upload", "/etc/passwd"], gwsBin),
      /--upload/,
    );
    assert.equal(existsSync(observedPath), false, "gws-bin must never be invoked");
  });
});
