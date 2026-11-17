import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPortsAvailable,
  fixtureVariables,
  verificationEnvironment,
} from "../run-isolated-e2e.mjs";
import { createWorkspaceSnapshot } from "./workspace-snapshot.mjs";

const origins = { accounts: "http://localhost:6173", wiki: "http://localhost:6177" };
const accountsUser = {
  id: "platform-oidc-user",
  email: "platform-oidc@test.local",
  name: "Platform OIDC Admin",
};

function nodeRuntime(source) {
  const configured =
    process.env.GDG_CI_NODE ??
    spawnSync("git", ["config", "--local", "--get", "gdgjp.ciNode"], {
      cwd: source,
      encoding: "utf8",
    }).stdout?.trim();
  const runtime = configured || process.execPath;
  if (!existsSync(runtime)) throw new Error(`Configured Node runtime is missing: ${runtime}`);
  return runtime;
}

export async function doctorPlatform(sourceDirectory) {
  const source = resolve(sourceDirectory);
  for (const path of [
    "package.json",
    "pnpm-workspace.yaml",
    "node_modules",
    "apps/accounts/node_modules",
    "apps/wiki/node_modules",
    "packages/design-system/package.json",
    "packages/gdg-lib/package.json",
    "scripts/run-e2e-dev.mjs",
  ]) {
    if (!existsSync(join(source, path))) throw new Error(`Missing prerequisite: ${path}`);
  }
  const runtime = nodeRuntime(source);
  const pnpm = spawnSync("pnpm", ["--version"], {
    env: { PATH: `${dirname(runtime)}:${process.env.PATH}` },
    stdio: "ignore",
  });
  if (pnpm.status !== 0) throw new Error("pnpm is unavailable");
  await assertPortsAvailable([6173, 6177]);
  return { source, runtime, origins };
}

function readVariables(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function writeAccountsFixture(snapshot, secrets) {
  const app = join(snapshot.root, "apps/accounts");
  const variables = readVariables(join(app, ".dev.vars"));
  if (!variables.BETTER_AUTH_SECRET) throw new Error("Accounts test secret is unavailable");
  const token = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", variables.BETTER_AUTH_SECRET)
    .update(token)
    .digest("base64");
  const value = encodeURIComponent(`${token}.${signature}`);
  for (const secret of [token, signature, value]) secrets.add(secret);
  const sessionId = `platform-session-${randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const sqlValue = (item) => `'${String(item).replaceAll("'", "''")}'`;
  const fixture = join(snapshot.root, ".verification-fixtures");
  mkdirSync(fixture, { recursive: true });
  const sql = [
    `INSERT INTO "user" (id, name, email, is_admin, created_at, updated_at, email_verified) VALUES (${[
      accountsUser.id,
      accountsUser.name,
      accountsUser.email,
    ]
      .map(sqlValue)
      .join(", ")}, 1, unixepoch(), unixepoch(), 1);`,
    `INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES (${[
      sessionId,
      expiresAt.toISOString(),
      token,
      now.toISOString(),
      now.toISOString(),
      accountsUser.id,
    ]
      .map(sqlValue)
      .join(", ")});`,
  ].join("\n");
  const sqlPath = join(fixture, "accounts-session.sql");
  writeFileSync(sqlPath, sql, { mode: 0o600 });
  const statePath = join(fixture, "accounts.json");
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        cookies: [
          {
            name: "gdgjp-accounts.session_token",
            value,
            domain: "localhost",
            path: "/",
            expires: Math.floor(expiresAt.getTime() / 1000),
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return { sqlPath, statePath, sessionId };
}

function fixtureCookie(path) {
  const state = JSON.parse(readFileSync(path, "utf8"));
  return state.cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export async function servePlatform(sourceDirectory) {
  const source = resolve(sourceDirectory);
  const { runtime } = await doctorPlatform(source);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = join(source, "local_data/pstack/platform", runId);
  mkdirSync(evidence, { recursive: true });
  const log = createWriteStream(join(evidence, "server.log"));
  const secrets = new Set();
  const children = new Map();
  const commands = [];
  let snapshot;
  let ready = false;
  let stopping = false;
  let exitCode = 1;
  const redact = (text) => {
    let safe = text;
    for (const secret of secrets) safe = safe.replaceAll(secret, "[local test credential]");
    return safe;
  };
  const writeLog = (text) => {
    const safe = redact(String(text));
    log.write(safe);
    process.stdout.write(safe);
  };
  const terminate = (signal = "SIGTERM") => {
    stopping = true;
    for (const child of children.keys()) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") writeLog(`Failed to stop child process: ${error.message}\n`);
      }
    }
  };
  const interrupt = () => terminate("SIGINT");
  const stop = () => terminate("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", stop);
  function start(command, args, cwd, env, quiet = false) {
    if (stopping) throw new Error("Verification was interrupted");
    commands.push({ command, args, cwd });
    if (!quiet) writeLog(`\n$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const completed = new Promise((done) => {
      child.once("error", (error) => {
        if (!quiet) writeLog(`${error.message}\n`);
        done(1);
      });
      child.once("close", (code) => {
        children.delete(child);
        done(code ?? 1);
      });
    });
    children.set(child, completed);
    if (!quiet) {
      for (const stream of [child.stdout, child.stderr]) {
        let pending = "";
        stream.on("data", (data) => {
          pending += String(data);
          const end = pending.lastIndexOf("\n");
          if (end !== -1) {
            writeLog(pending.slice(0, end + 1));
            pending = pending.slice(end + 1);
          }
        });
        stream.on("end", () => pending && writeLog(pending));
      }
    } else {
      child.stdout.resume();
      child.stderr.resume();
    }
    return { child, completed };
  }
  async function execute(command, args, cwd, env, quiet = false) {
    const code = await start(command, args, cwd, env, quiet).completed;
    if (code !== 0) throw new Error(`${quiet ? "Fixture installation" : command} failed (${code})`);
  }
  async function waitFor(url, check) {
    const deadline = Date.now() + 180_000;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (await check(response)) return;
      } catch {}
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(stopping ? "Verification was interrupted" : `Readiness timed out: ${url}`);
  }
  try {
    snapshot = createWorkspaceSnapshot(source);
    fixtureVariables(snapshot);
    const environment = verificationEnvironment({ source, root: snapshot.root });
    const accounts = join(snapshot.root, "apps/accounts");
    const wiki = join(snapshot.root, "apps/wiki");
    writeLog(`Evidence: ${evidence}\n`);
    await execute(
      "pnpm",
      ["--filter", "@gdgjp/accounts", "migrate:local"],
      snapshot.root,
      environment,
    );
    await execute(runtime, ["tests/e2e/setup.ts"], wiki, environment);
    const accountFixture = writeAccountsFixture(snapshot, secrets);
    await execute(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "gdgjp-accounts-db",
        "--local",
        "--file",
        accountFixture.sqlPath,
      ],
      accounts,
      environment,
      true,
    );
    await execute(
      "pnpm",
      [
        "exec",
        "turbo",
        "build",
        "--concurrency=2",
        "--env-mode=loose",
        "--filter=@gdgjp/accounts",
        "--filter=@gdgjp/wiki",
      ],
      snapshot.root,
      environment,
    );
    const authFixtures = {
      accounts: accountFixture.statePath,
      ...Object.fromEntries(
        ["author", "member", "admin"].map((role) => [
          role,
          join(wiki, "tests/e2e/storage-state", `${role}.json`),
        ]),
      ),
    };
    const manifest = {
      source,
      scratch: snapshot.root,
      runtime,
      origins,
      browserDriver: "orca browser",
      evidence,
      authFixtures,
      fixtureUsers: {
        accounts: accountsUser.id,
        author: "e2e-author-user-id",
        member: "e2e-member-user-id",
        admin: "e2e-admin-user-id",
      },
      seededPageUrl: `${origins.wiki}/wiki/e2e-test-page`,
      wikiAuthoringUrl: `${origins.wiki}/s/gdg-jp/wiki/new`,
      accountSessionUrl: `${origins.accounts}/api/auth/get-session`,
      hashes: snapshot.hashes,
      revisions: snapshot.revisions,
      externalBindings: "disabled by the isolated built-preview runner",
    };
    writeFileSync(join(evidence, "run.json"), JSON.stringify(manifest, null, 2));
    const servers = [
      start(runtime, ["../../scripts/run-e2e-dev.mjs", "6173"], accounts, {
        ...environment,
        GDG_E2E_BUILT: "accounts,wiki",
      }),
      start(runtime, ["../../scripts/run-e2e-dev.mjs", "6177"], wiki, {
        ...environment,
        GDG_E2E_BUILT: "accounts,wiki",
        WIKI_E2E_PERSIST_TO: ".wrangler/e2e-state",
      }),
    ];
    await waitFor(origins.accounts, async (response) => response.ok);
    await waitFor(`${origins.wiki}/og-image.png`, async (response) => response.ok);
    const sessionResponse = await fetch(manifest.accountSessionUrl, {
      headers: { cookie: fixtureCookie(authFixtures.accounts) },
      signal: AbortSignal.timeout(30_000),
    });
    const session = await sessionResponse.json();
    if (!sessionResponse.ok || session?.user?.id !== accountsUser.id) {
      throw new Error(`Accounts session fixture unusable: HTTP ${sessionResponse.status}`);
    }
    const clientSeed = await fetch(`${origins.accounts}/admin/seed-clients`, {
      method: "POST",
      headers: { cookie: fixtureCookie(authFixtures.accounts) },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    await clientSeed.text();
    if (!clientSeed.ok) {
      throw new Error(`Accounts client fixtures unusable: HTTP ${clientSeed.status}`);
    }
    const pageResponse = await fetch(manifest.seededPageUrl, {
      headers: { cookie: fixtureCookie(authFixtures.author) },
      signal: AbortSignal.timeout(120_000),
    });
    const html = await pageResponse.text();
    if (!pageResponse.ok || !html.includes("E2E Test Page")) {
      throw new Error(`Wiki author fixture unusable: HTTP ${pageResponse.status}`);
    }
    const checks = {
      accountsSession: { status: sessionResponse.status, userId: session.user.id },
      accountsClients: { status: clientSeed.status, method: "POST /admin/seed-clients" },
      wikiAuthorPage: { status: pageResponse.status, expectedTitleFound: true },
    };
    writeFileSync(join(evidence, "ready.json"), JSON.stringify({ ...manifest, checks }, null, 2));
    ready = true;
    console.log(
      `READY ${JSON.stringify({ evidence, ready: join(evidence, "ready.json"), origins })}`,
    );
    const stopped = await Promise.race(servers.map(({ completed }) => completed));
    if (!stopping) throw new Error(`Verification server stopped unexpectedly (${stopped})`);
    exitCode = 0;
  } catch (error) {
    writeLog(`\n${error.stack ?? error.message}\n`);
    if (stopping) exitCode = 0;
  } finally {
    terminate();
    const outstanding = [...children.values()];
    await Promise.race([
      Promise.allSettled(outstanding),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
    for (const child of children.keys()) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") writeLog(`Failed to stop child process: ${error.message}\n`);
      }
    }
    await Promise.allSettled([...children.values()]);
    snapshot?.dispose();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", stop);
    await new Promise((done) => log.end(done));
    writeFileSync(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          helperReady: ready,
          journeyStatus: "NOT VERIFIED",
          exitCode,
          scratchRemoved: !snapshot || !existsSync(snapshot.root),
          commands,
        },
        null,
        2,
      ),
    );
    console.log(`Cleanup complete; evidence retained at ${evidence}`);
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    let serve = false;
    let help = false;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      if (args[index] === "--source" && args[index + 1]) source = resolve(args[++index]);
      else if (args[index] === "--serve") serve = true;
      else if (args[index] === "--help") help = true;
      else if (args[index] !== "--doctor") throw new Error(`Unknown argument: ${args[index]}`);
    }
    if (help) console.log("Usage: verify-platform.mjs [--source <checkout>] [--doctor | --serve]");
    else if (serve) process.exitCode = await servePlatform(source);
    else console.log(`Doctor passed: ${JSON.stringify(await doctorPlatform(source))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
