#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPortsAvailable,
  fixtureVariables,
  verificationEnvironment,
} from "../../../../scripts/run-isolated-e2e.mjs";
import { createWorkspaceSnapshot } from "../../../../scripts/verification/workspace-snapshot.mjs";
import { applications, identityLogin, origin, requiredPorts, selectApplications } from "./apps.mjs";
import { liveCheckinClientSql, mintIdentities } from "./identities.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function parseArguments(args) {
  const options = { source: repository, mode: "doctor", apps: undefined, accounts: undefined };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--source" && args[index + 1]) options.source = resolve(args[++index]);
    else if (argument === "--app" && args[index + 1]) options.apps = args[++index];
    else if (argument === "--accounts" && args[index + 1])
      options.accounts = resolve(args[++index]);
    else if (argument === "--serve") options.mode = "serve";
    else if (argument === "--doctor") options.mode = "doctor";
    else if (argument === "--help") options.mode = "help";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.mode !== "help") options.apps = selectApplications(options.apps);
  return options;
}

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

export function readPlatform(path) {
  if (!path) return null;
  const ready = JSON.parse(readFileSync(path, "utf8"));
  const registry = join(ready.scratch ?? "", ".e2e-registry");
  if (!ready.origins?.accounts || !existsSync(registry)) {
    throw new Error(`Platform stack is not running: ${path}`);
  }
  return {
    readyPath: path,
    accounts: ready.origins.accounts,
    registry,
    accountsDirectory: join(ready.scratch, "apps/accounts"),
  };
}

export async function doctorApplications({ source, apps, accounts }) {
  source = resolve(source);
  const missing = [
    "package.json",
    "pnpm-workspace.yaml",
    "node_modules",
    "packages/gdg-lib/package.json",
    "scripts/run-e2e-dev.mjs",
    ...apps.flatMap((name) => [
      `${applications[name].directory}/package.json`,
      `${applications[name].directory}/node_modules`,
      ...(applications[name].designSystem ? ["packages/design-system/package.json"] : []),
    ]),
  ].filter((path) => !existsSync(join(source, path)));
  if (missing.length) throw new Error(`Missing prerequisite: ${missing.join(", ")}`);
  const runtime = nodeRuntime(source);
  const pnpm = spawnSync("pnpm", ["--version"], {
    env: { PATH: `${dirname(runtime)}:${process.env.PATH}` },
    stdio: "ignore",
  });
  if (pnpm.status !== 0) throw new Error("pnpm is unavailable");
  const platform = readPlatform(accounts);
  await assertPortsAvailable(requiredPorts(apps));
  return {
    source,
    runtime,
    apps: Object.fromEntries(apps.map((name) => [name, origin(name)])),
    accounts: platform?.accounts ?? null,
  };
}

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .filter((pair) => pair.includes("=") && !pair.endsWith("="));
}

export async function probePage(base, { path, text, redirect }, cookie) {
  const response = await fetch(new URL(path, base), {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  return {
    path,
    status: response.status,
    location: response.headers.get("location"),
    expectedText: text,
    expectedTextFound: text ? body.includes(text) : null,
    body,
    ok: redirect
      ? response.status >= 300 &&
        response.status < 400 &&
        (response.headers.get("location") ?? "").includes(redirect)
      : response.status === 200 && (!text || body.includes(text)),
  };
}

export async function signInFixture(base, loginPath) {
  const response = await fetch(new URL(loginPath, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  await response.text();
  const cookies = cookiesFrom(response);
  if (response.status !== 302 || !cookies.length) {
    throw new Error(`Fixture sign-in failed at ${loginPath}: HTTP ${response.status}`);
  }
  return cookies.join("; ");
}

function retained(save, label, { body, ...result }) {
  save?.(label, body);
  return result;
}

export async function checkApplication(name, base, { identities = {}, platform, save } = {}) {
  const definition = applications[name];
  const checks = {
    anonymous: retained(save, `${name}-anonymous`, await probePage(base, definition.anonymous)),
  };
  if (!checks.anonymous.ok) {
    throw new Error(`${name} anonymous probe failed: ${JSON.stringify(checks.anonymous)}`);
  }
  if (definition.gated) {
    const gated = retained(
      save,
      `${name}-gated`,
      await probePage(base, { path: definition.gated, text: "" }),
    );
    checks.gated = { ...gated, ok: gated.status === 302 && /\/signin/.test(gated.location ?? "") };
    if (!checks.gated.ok) throw new Error(`${name} did not gate ${definition.gated}`);
  }
  checks.identities = {};
  for (const [identity, { probe, cookie: minted }] of Object.entries(definition.identities)) {
    const cookie = minted
      ? identities[identity]
      : await signInFixture(base, identityLogin(name, identity));
    if (!cookie) throw new Error(`${name} ${identity} has no fixture cookie`);
    const result = retained(save, `${name}-${identity}`, await probePage(base, probe, cookie));
    checks.identities[identity] = result;
    if (!result.ok) throw new Error(`${name} ${identity} probe failed: ${JSON.stringify(result)}`);
  }
  if (platform && definition.gated) {
    let url = new URL("/signin?return_to=%2F", base);
    const hops = [];
    for (let hop = 0; hop < 4 && url.origin === new URL(base).origin; hop++) {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      await response.text();
      const location = response.headers.get("location");
      hops.push({ path: url.pathname, status: response.status });
      if (!location) break;
      url = new URL(location, url);
    }
    checks.oidc = {
      hops,
      authorizeOrigin: url.origin,
      authorizePath: url.pathname,
      ok: url.origin === platform.accounts && url.pathname === "/api/auth/oauth2/authorize",
    };
    if (!checks.oidc.ok) throw new Error(`${name} sign-in does not reach ${platform.accounts}`);
  }
  return checks;
}

async function seed(base, seeds) {
  const results = [];
  for (const { path, method = "GET" } of seeds) {
    const response = await fetch(new URL(path, base), {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.text();
    results.push({ method, path, status: response.status, body: body.slice(0, 200) });
    if (response.status >= 400)
      throw new Error(`Seed failed: ${method} ${path} ${response.status}`);
  }
  return results;
}

export async function serveApplications({ source, apps, accounts }) {
  source = resolve(source);
  const { runtime } = await doctorApplications({ source, apps, accounts });
  const platform = readPlatform(accounts);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = join(source, "local_data/pstack/apps", runId);
  mkdirSync(evidence, { recursive: true });
  const log = createWriteStream(join(evidence, "server.log"));
  const children = new Map();
  const commands = [];
  let snapshot;
  let ready = false;
  let stopping = false;
  let exitCode = 1;
  const stoppedServers = [];
  const writeLog = (text) => {
    log.write(String(text));
    process.stdout.write(String(text));
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
  function start(command, args, cwd, env) {
    if (stopping) throw new Error("Verification was interrupted");
    commands.push({ command, args, cwd });
    writeLog(`\n$ ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const completed = new Promise((done) => {
      child.once("error", (error) => {
        writeLog(`${error.message}\n`);
        done(1);
      });
      child.once("close", (code) => {
        children.delete(child);
        done(code ?? 1);
      });
    });
    children.set(child, completed);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", writeLog);
    return { child, completed };
  }
  async function execute(command, args, cwd, env) {
    const code = await start(command, args, cwd, env).completed;
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} failed (${code})`);
  }
  async function waitFor(url) {
    const deadline = Date.now() + 240_000;
    while (!stopping && Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        });
        await response.text();
        if (response.status < 500) return;
      } catch {}
      await new Promise((done) => setTimeout(done, 500));
    }
    throw new Error(stopping ? "Verification was interrupted" : `Readiness timed out: ${url}`);
  }
  try {
    snapshot = createWorkspaceSnapshot(source);
    fixtureVariables(snapshot);
    const environment = verificationEnvironment({ source, root: snapshot.root });
    if (platform) {
      environment.MINIFLARE_REGISTRY_PATH = platform.registry;
      environment.WRANGLER_REGISTRY_PATH = platform.registry;
    }
    writeLog(`Evidence: ${evidence}\n`);
    const built = apps.filter((name) => applications[name].mode === "built");
    if (apps.some((name) => applications[name].designSystem)) {
      await execute(
        "pnpm",
        ["--filter", "@gdgjp/design-system", "build:e2e"],
        snapshot.root,
        environment,
      );
    }
    for (const name of apps) {
      const definition = applications[name];
      const directory = join(snapshot.root, definition.directory);
      if (definition.d1) {
        await execute(
          "pnpm",
          ["exec", "wrangler", "d1", "migrations", "apply", definition.d1, "--local"],
          directory,
          environment,
        );
      }
      if (definition.build) await execute("pnpm", definition.build, directory, environment);
    }
    const identities = await mintIdentities(snapshot, apps, platform?.accounts);
    if (platform && apps.includes("live-checkin")) {
      await execute(
        "pnpm",
        [
          "exec",
          "wrangler",
          "d1",
          "execute",
          "gdgjp-accounts-db",
          "--local",
          "--command",
          liveCheckinClientSql(),
        ],
        platform.accountsDirectory,
        environment,
      );
    }
    const manifest = {
      source,
      scratch: snapshot.root,
      runtime,
      browserDriver: "orca browser",
      evidence,
      platform: platform?.readyPath ?? null,
      applications: Object.fromEntries(
        apps.map((name) => [
          name,
          {
            origin: origin(name),
            mode: applications[name].mode,
            fixtureLogins: Object.fromEntries(
              Object.entries(applications[name].identities)
                .filter(([, value]) => !value.cookie)
                .map(([identity, value]) => [
                  identity,
                  {
                    url: `${origin(name)}${identityLogin(name, identity)}`,
                    userId: `dev-user-${value.as}`,
                    chapters: value.chapters,
                  },
                ]),
            ),
            cookieFixtures: identities.files[name] ?? {},
          },
        ]),
      ),
      hashes: snapshot.hashes,
      revisions: snapshot.revisions,
    };
    writeFileSync(join(evidence, "run.json"), JSON.stringify(manifest, null, 2));
    const servers = [];
    for (const name of apps) {
      const definition = applications[name];
      const directory = join(snapshot.root, definition.directory);
      for (const companion of definition.companions ?? []) {
        servers.push({
          name: `${name}:${companion.name}`,
          ...start(runtime, companion.args, directory, environment),
        });
      }
      if (definition.mode === "next") {
        servers.push({
          name,
          ...start(
            "pnpm",
            ["exec", "next", "dev", "--webpack", "--port", String(definition.port)],
            directory,
            { ...environment, ...identities.environment[name] },
          ),
        });
      } else {
        servers.push({
          name,
          ...start(runtime, ["../../scripts/run-e2e-dev.mjs", String(definition.port)], directory, {
            ...environment,
            GDG_E2E_BUILT: built.join(","),
            ...(platform ? { WIKI_E2E_ISSUER: platform.accounts } : {}),
          }),
        });
      }
    }
    const checks = {};
    for (const name of apps) {
      await waitFor(origin(name));
      checks[name] = { seeds: await seed(origin(name), applications[name].seeds) };
      Object.assign(
        checks[name],
        await checkApplication(name, origin(name), {
          identities: identities.cookies[name],
          platform,
          save: (label, body) => {
            mkdirSync(join(evidence, "probes"), { recursive: true });
            writeFileSync(join(evidence, "probes", `${label}.html`), body);
          },
        }),
      );
    }
    writeFileSync(join(evidence, "ready.json"), JSON.stringify({ ...manifest, checks }, null, 2));
    ready = true;
    console.log(
      `READY ${JSON.stringify({ evidence, ready: join(evidence, "ready.json"), apps: manifest.applications })}`,
    );
    const running = new Map(servers.map(({ name, completed }) => [name, completed]));
    while (running.size && !stopping) {
      const [name, code] = await Promise.race(
        [...running].map(([label, completed]) => completed.then((value) => [label, value])),
      );
      running.delete(name);
      if (stopping) break;
      stoppedServers.push({ name, code, at: new Date().toISOString() });
      writeLog(`\nSTOPPED ${name} exited unexpectedly (${code}); other servers keep running\n`);
    }
    if (!stopping) throw new Error("Every verification server stopped unexpectedly");
    exitCode = stoppedServers.length ? 1 : 0;
  } catch (error) {
    writeLog(`\n${error.stack ?? error.message}\n`);
    if (stopping) exitCode = 0;
  } finally {
    terminate();
    await Promise.race([
      Promise.allSettled([...children.values()]),
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
    let portsFree = false;
    try {
      await assertPortsAvailable(requiredPorts(apps));
      portsFree = true;
    } catch {}
    writeFileSync(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          helperReady: ready,
          journeyStatus: "NOT VERIFIED",
          exitCode,
          scratchRemoved: !snapshot || !existsSync(snapshot.root),
          portsFree,
          stoppedServers,
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
    const options = parseArguments(process.argv.slice(2));
    if (options.mode === "help") {
      console.log(
        `Usage: verify-apps.mjs --app <${Object.keys(applications).join("|")}>[,...] [--source <checkout>] [--accounts <platform ready.json>] [--doctor | --serve]`,
      );
    } else if (options.mode === "serve") process.exitCode = await serveApplications(options);
    else console.log(`Doctor passed: ${JSON.stringify(await doctorApplications(options))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
