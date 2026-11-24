#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPortsAvailable,
  fixtureVariables,
  verificationEnvironment,
} from "../run-isolated-e2e.mjs";
import {
  devLogin,
  forbiddenPresent,
  identityLogins,
  origin,
  profiles,
  requiredPorts,
  selectProfiles,
} from "./app-stack-profiles.mjs";
import { createWorkspaceSnapshot } from "./workspace-snapshot.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const usage = `Usage: app-stack.mjs --app <${Object.keys(profiles).join("|")}>[,...] [--source <checkout>] [--platform <verify-platform ready.json>] [--no-seed] [--fonts <directory>] [--doctor | --serve]`;

export function parseArguments(args) {
  const options = {
    source: repository,
    mode: "doctor",
    apps: undefined,
    platform: null,
    seed: true,
    fonts: null,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--source" && args[index + 1]) options.source = resolve(args[++index]);
    else if (argument === "--app" && args[index + 1]) options.apps = args[++index];
    else if (argument === "--platform" && args[index + 1])
      options.platform = resolve(args[++index]);
    else if (argument === "--fonts" && args[index + 1]) options.fonts = resolve(args[++index]);
    else if (argument === "--no-seed") options.seed = false;
    else if (argument === "--serve") options.mode = "serve";
    else if (argument === "--doctor") options.mode = "doctor";
    else if (argument === "--help") options.mode = "help";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.mode !== "help") options.apps = selectProfiles(options.apps);
  return options;
}

export function readVariables(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^"(.*)"$/, "$1"),
        ];
      }),
  );
}

export function mergeVariables(text, overrides = {}) {
  const merged = { ...readVariables(text), ...overrides };
  return Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");
}

export function registerClientSql(clientId, appOrigin) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const add = (column, uri) =>
    `"${column}" = CASE WHEN "${column}" LIKE ${quote(`%${uri}%`)} THEN "${column}" ELSE json_insert(COALESCE("${column}", '[]'), '$[#]', ${quote(uri)}) END`;
  return `UPDATE "oauthClient" SET ${add("redirectUris", `${appOrigin}/api/auth/callback/gdgjp`)}, ${add("postLogoutRedirectUris", `${appOrigin}/signin`)} WHERE "clientId" = ${quote(clientId)};`;
}

export function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .filter((pair) => pair.includes("=") && !pair.endsWith("="));
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
    throw new Error(`verify-platform stack is not running: ${path}`);
  }
  return {
    readyPath: path,
    accounts: ready.origins.accounts,
    registry,
    accountsDirectory: join(ready.scratch, "apps/accounts"),
  };
}

export function fontDirectory(source, explicit) {
  const candidate = explicit ?? join(source, "apps/pr/node_modules/.cache/gdg-fonts");
  if (!existsSync(candidate)) return null;
  const files = readdirSync(candidate).filter((file) => file.endsWith(".ttf"));
  return files.length ? { directory: candidate, files } : null;
}

export async function doctorStack({ source, apps, platform }) {
  source = resolve(source);
  const missing = [
    "package.json",
    "pnpm-workspace.yaml",
    "node_modules",
    "packages/gdg-lib/package.json",
    "scripts/run-e2e-dev.mjs",
    ...apps.flatMap((name) => {
      const profile = profiles[name];
      return [
        `${profile.directory}/package.json`,
        `${profile.directory}/node_modules`,
        ...(profile.designSystem ? ["packages/design-system/package.json"] : []),
        ...(profile.seed ? [`.agents/skills/${profile.seed}`] : []),
        ...(name === "pr" ? ["skills/pr-playbook/SKILL.md"] : []),
      ];
    }),
  ].filter((path) => !existsSync(join(source, path)));
  if (missing.length) throw new Error(`Missing prerequisite: ${missing.join(", ")}`);
  const runtime = nodeRuntime(source);
  const pnpm = spawnSync("pnpm", ["--version"], {
    env: { PATH: `${dirname(runtime)}:${process.env.PATH}` },
    stdio: "ignore",
  });
  if (pnpm.status !== 0) throw new Error("pnpm is unavailable");
  const attached = readPlatform(platform);
  await assertPortsAvailable(requiredPorts(apps));
  return {
    source,
    runtime,
    apps: Object.fromEntries(apps.map((name) => [name, origin(name)])),
    platform: attached?.accounts ?? null,
    fonts: apps.includes("pr") ? (fontDirectory(source)?.files.length ?? 0) : null,
  };
}

export async function probe(base, { path, text, redirect, bearer, status = 200 }, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(new URL(path, base), {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  const location = response.headers.get("location");
  const ok = redirect
    ? response.status >= 300 && response.status < 400 && (location ?? "").includes(redirect)
    : response.status === status && (!text || body.includes(text));
  return {
    path,
    status: response.status,
    location,
    expectedText: text ?? null,
    expectedTextFound: text ? body.includes(text) : null,
    ok,
    body,
  };
}

export async function signIn(base, loginPath) {
  const response = await fetch(new URL(loginPath, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  await response.text();
  const cookies = cookiesFrom(response);
  if (response.status < 300 || response.status >= 400 || !cookies.length) {
    throw new Error(`Fixture sign-in failed at ${loginPath}: HTTP ${response.status}`);
  }
  return cookies.join("; ");
}

export async function checkApplication(name, base, save, attached = false) {
  const profile = profiles[name];
  const strip = (label, { body, ...result }) => {
    save(label, body);
    return result;
  };
  const checks = {};
  checks.anonymous = strip(`${name}-anonymous`, await probe(base, profile.anonymous));
  if (!checks.anonymous.ok) throw new Error(`${name} anonymous probe failed`);
  const target = attached && profile.platformProbe ? profile.platformProbe : profile.probe;
  if (target.identity) {
    const identity = profile.identities[target.identity];
    const cookie = await signIn(
      base,
      devLogin(identity.as, identity.chapters, { admin: identity.admin }),
    );
    checks.identity = {
      label: target.identity,
      userId: `dev-user-${identity.as}`,
      ...strip(`${name}-${target.identity}`, await probe(base, target, cookie)),
    };
  } else {
    checks.identity = {
      label: `bearer ${target.bearer}`,
      ...strip(`${name}-bearer`, await probe(base, target)),
    };
  }
  if (!checks.identity.ok) throw new Error(`${name} signed-in probe failed`);
  if (name === "pr") {
    const mocks = await fetch(new URL("/dev/mock-services", base), {
      signal: AbortSignal.timeout(60_000),
    });
    const state = await mocks.json();
    const messages = await fetch(`${profile.fixtures.captureServer}/messages`, {
      signal: AbortSignal.timeout(10_000),
    });
    const captured = await messages.json();
    checks.sendBaseline = {
      mockServicesStatus: mocks.status,
      snsCalls: state.sns?.calls ?? null,
      snsPosts: state.sns?.posts?.length ?? null,
      discordMessages: captured.length,
      ok: mocks.ok && state.sns?.calls === 0 && captured.length === 0,
    };
    if (!checks.sendBaseline.ok) throw new Error("pr send baseline is not empty");
  }
  return checks;
}

function credentialGate(root, apps) {
  const findings = {};
  for (const name of apps) {
    const profile = profiles[name];
    for (const file of [".dev.vars", ".dev.vars.e2e"]) {
      const path = join(root, profile.directory, file);
      if (!existsSync(path)) continue;
      const present = forbiddenPresent(
        readVariables(readFileSync(path, "utf8")),
        profile.forbiddenVariables,
      );
      findings[`${name}/${file}`] = present;
      if (present.length) throw new Error(`${name} ${file} defines ${present.join(", ")}`);
    }
  }
  return findings;
}

export async function serveStack(options) {
  const source = resolve(options.source);
  const { apps } = options;
  const { runtime } = await doctorStack({ ...options, source });
  const platform = readPlatform(options.platform);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = join(source, "local_data/pstack", apps.join("-"), runId);
  mkdirSync(evidence, { recursive: true });
  const log = createWriteStream(join(evidence, "server.log"));
  const children = new Map();
  const commands = [];
  let snapshot;
  let ready = false;
  let stopping = false;
  let exitCode = 1;
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
  async function execute(command, args, cwd, env, attempts = 1) {
    for (let attempt = 1; ; attempt++) {
      const code = await start(command, args, cwd, env).completed;
      if (code === 0) return;
      if (attempt >= attempts || stopping)
        throw new Error(`${command} ${args.join(" ")} failed (${code})`);
      writeLog(`Retrying idempotent step (${attempt + 1}/${attempts})\n`);
    }
  }
  async function waitFor(url) {
    const deadline = Date.now() + 300_000;
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
  const save = (label, body) => {
    mkdirSync(join(evidence, "probes"), { recursive: true });
    writeFileSync(join(evidence, "probes", `${label}.html`), body);
  };
  try {
    snapshot = createWorkspaceSnapshot(source);
    fixtureVariables(snapshot);
    for (const name of apps) {
      const path = join(snapshot.root, profiles[name].directory, ".dev.vars");
      const current = existsSync(path) ? readFileSync(path, "utf8") : "";
      writeFileSync(path, mergeVariables(current, profiles[name].variables), { mode: 0o600 });
    }
    const credentials = { beforeStart: credentialGate(snapshot.root, apps) };
    const environment = verificationEnvironment({ source, root: snapshot.root });
    if (platform) {
      environment.MINIFLARE_REGISTRY_PATH = platform.registry;
      environment.WRANGLER_REGISTRY_PATH = platform.registry;
      environment.WIKI_E2E_ISSUER = platform.accounts;
    }
    writeLog(`Evidence: ${evidence}\n`);
    if (apps.some((name) => profiles[name].designSystem)) {
      await execute(
        "pnpm",
        ["--filter", "@gdgjp/design-system", "build:e2e"],
        snapshot.root,
        environment,
      );
    }
    const fixtures = {};
    for (const name of apps) {
      const profile = profiles[name];
      const directory = join(snapshot.root, profile.directory);
      const persistence = profile.persistence ? join(snapshot.root, profile.persistence) : null;
      const persist = persistence ? ["--persist-to", persistence] : [];
      if (persistence) mkdirSync(persistence, { recursive: true });
      await execute(
        "pnpm",
        ["exec", "wrangler", "d1", "migrations", "apply", profile.d1, "--local", ...persist],
        directory,
        environment,
        3,
      );
      fixtures[name] = { persistence, seed: null, r2: [], fonts: null, accountsSeed: null };
      if (options.seed && profile.seed) {
        const file = join(source, ".agents/skills", profile.seed);
        await execute(
          "pnpm",
          ["exec", "wrangler", "d1", "execute", profile.d1, "--local", ...persist, "--file", file],
          directory,
          environment,
        );
        fixtures[name].seed = file;
      }
      if (options.seed) {
        for (const object of profile.r2 ?? []) {
          await execute(
            "pnpm",
            [
              "exec",
              "wrangler",
              "r2",
              "object",
              "put",
              object.key,
              "--local",
              ...persist,
              "--file",
              object.file,
              "--content-type",
              object.contentType,
            ],
            directory,
            environment,
            3,
          );
          fixtures[name].r2.push(object.key);
        }
      }
      if (profile.fonts) {
        const fonts = fontDirectory(source, options.fonts);
        fixtures[name].fonts = fonts ? [] : "not seeded: no local font cache";
        for (const file of fonts?.files ?? []) {
          await execute(
            "pnpm",
            [
              "exec",
              "wrangler",
              "r2",
              "object",
              "put",
              `gdgjp-pr-images/fonts/${file}`,
              "--file",
              join(fonts.directory, file),
              "--content-type",
              "font/ttf",
              "--local",
              ...persist,
            ],
            directory,
            environment,
            3,
          );
          fixtures[name].fonts.push(file);
        }
      }
      if (platform && options.seed && profile.accountsSeed) {
        const file = join(source, ".agents/skills", profile.accountsSeed);
        await execute(
          "pnpm",
          [
            "exec",
            "wrangler",
            "d1",
            "execute",
            "gdgjp-accounts-db",
            "--local",
            "--persist-to",
            ".wrangler/state",
            "--file",
            file,
          ],
          platform.accountsDirectory,
          environment,
        );
        fixtures[name].accountsSeed = file;
      }
      if (platform) {
        await execute(
          "pnpm",
          [
            "exec",
            "wrangler",
            "d1",
            "execute",
            "gdgjp-accounts-db",
            "--local",
            "--persist-to",
            ".wrangler/state",
            "--command",
            registerClientSql(name, origin(name)),
          ],
          platform.accountsDirectory,
          environment,
        );
        fixtures[name].accountsClient = {
          clientId: name,
          redirectUri: `${origin(name)}/api/auth/callback/gdgjp`,
          postLogoutRedirectUri: `${origin(name)}/signin`,
        };
      }
      if (profile.mode === "built") await execute("pnpm", ["run", "build"], directory, environment);
    }
    const built = apps.filter((name) => profiles[name].mode === "built");
    const manifest = {
      source,
      scratch: snapshot.root,
      runtime,
      browserDriver: "orca browser",
      evidence,
      platform: platform?.readyPath ?? null,
      accounts: platform?.accounts ?? null,
      applications: Object.fromEntries(
        apps.map((name) => [
          name,
          {
            origin: origin(name),
            directory: join(snapshot.root, profiles[name].directory),
            mode: profiles[name].mode,
            d1: profiles[name].d1,
            persistence: fixtures[name].persistence,
            identities: identityLogins(name),
            bearer: profiles[name].bearer ?? null,
            fixtures: { ...fixtures[name], ...(profiles[name].fixtures ?? {}) },
          },
        ]),
      ),
      hashes: snapshot.hashes,
      revisions: snapshot.revisions,
      externalBindings: "local fakes or loopback only; see each skill's feature map",
    };
    writeFileSync(join(evidence, "run.json"), JSON.stringify(manifest, null, 2));
    const servers = [];
    for (const name of apps) {
      const profile = profiles[name];
      const directory = join(snapshot.root, profile.directory);
      const persistence = fixtures[name].persistence;
      const appEnvironment = {
        ...environment,
        ...(profile.serverEnvironment ?? {}),
        ...(platform && profile.accountsUrlVariable
          ? { [profile.accountsUrlVariable]: platform.accounts }
          : {}),
        ...(persistence ? { PR_E2E_PERSIST_TO: persistence } : {}),
        GDG_E2E_BUILT: built.join(","),
      };
      for (const companion of profile.companions ?? []) {
        const args = companion.script
          ? [join(repository, "scripts/verification", companion.script), directory]
          : companion.args;
        servers.push(start(runtime, args, directory, { ...appEnvironment, ...companion.env }));
      }
      servers.push(
        start(
          runtime,
          ["../../scripts/run-e2e-dev.mjs", String(profile.port)],
          directory,
          appEnvironment,
        ),
      );
    }
    const checks = {};
    for (const name of apps) {
      await waitFor(origin(name));
      checks[name] = await checkApplication(name, origin(name), save, Boolean(platform));
    }
    credentials.afterStart = credentialGate(snapshot.root, apps);
    writeFileSync(
      join(evidence, "ready.json"),
      JSON.stringify({ ...manifest, checks, credentials }, null, 2),
    );
    ready = true;
    console.log(`READY ${JSON.stringify({ evidence, ready: join(evidence, "ready.json") })}`);
    const stopped = await Promise.race(servers.map(({ completed }) => completed));
    if (!stopping) throw new Error(`Verification server stopped unexpectedly (${stopped})`);
    exitCode = 0;
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
    if (options.mode === "help") console.log(usage);
    else if (options.mode === "serve") process.exitCode = await serveStack(options);
    else console.log(`Doctor passed: ${JSON.stringify(await doctorStack(options))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
