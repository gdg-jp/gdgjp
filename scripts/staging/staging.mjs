import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { DEPLOY_TARGETS } from "../../.github/scripts/changed-workspaces.mjs";
import {
  EXCLUDED_APPS,
  POST_SYNC_SQL,
  SLOTS,
  assertSlot,
  classifySchema,
  composeImport,
  isStagingName,
  missingSecrets,
  requiredResources,
  rewriteUrls,
  rewriteWorkerConfig,
  stagingName,
  withoutWorkerTargets,
  workerTargets,
} from "./lib.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const API = "https://api.cloudflare.com/client/v4";
export const RELYING_PARTY_APPS = [
  "tinyurl",
  "wiki",
  "img",
  "scheduler",
  "sns",
  "pay",
  "ost",
  "roster",
  "mc",
  "screen",
  "deck",
  "roulette",
  "pr",
  "meet",
];

function log(message) {
  process.stderr.write(`${message}\n`);
}

function run(command, args, { cwd = ROOT, capture = false, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr}${result.stdout}` : "";
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

function wrangler(args, options = {}) {
  return run("pnpm", ["exec", "wrangler", ...args], {
    ...options,
    cwd: options.cwd ?? join(ROOT, "apps/accounts"),
  });
}

let credentials;
function cloudflare() {
  if (!credentials) {
    const token =
      process.env.CLOUDFLARE_API_TOKEN ??
      wrangler(["auth", "token"], { capture: true }).trim().split("\n").at(-1).trim();
    credentials = { token, account: process.env.CLOUDFLARE_ACCOUNT_ID };
  }
  return credentials;
}

async function api(path, { method = "GET", body, raw = false } = {}) {
  const { token } = cloudflare();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.success)
    throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors ?? json)}`);
  return raw ? json : json.result;
}

async function accountId() {
  const current = cloudflare();
  if (!current.account) {
    const accounts = await api("/accounts");
    if (accounts.length !== 1)
      throw new Error("Set CLOUDFLARE_ACCOUNT_ID; the token can see several accounts");
    current.account = accounts[0].id;
  }
  return current.account;
}

async function paged(path) {
  const results = [];
  for (let page = 1; ; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const json = await api(`${path}${separator}page=${page}&per_page=100`, { raw: true });
    results.push(...json.result);
    const info = json.result_info;
    if (!info || json.result.length === 0 || page * (info.per_page ?? 100) >= info.total_count)
      return results;
  }
}

export function stagingApps() {
  return DEPLOY_TARGETS.filter(
    ({ provider, app }) => provider === "cloudflare" && !EXCLUDED_APPS.has(app),
  ).map(({ app, workspace }) => {
    const directory = join(ROOT, "apps", app);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const toml = parseToml(readFileSync(join(directory, "wrangler.toml"), "utf8"));
    const migrateDatabases = [
      ...(manifest.scripts?.["migrate:remote"] ?? "").matchAll(/d1 migrations apply (\S+)/g),
    ].map((match) => match[1]);
    return { app, workspace, directory, worker: toml.name, toml, migrateDatabases };
  });
}

function sourceConfig(app) {
  const built = join(app.directory, "build/server/wrangler.json");
  if (existsSync(built))
    return {
      config: JSON.parse(readFileSync(built, "utf8")),
      directory: join(app.directory, "build/server"),
    };
  return { config: app.toml, directory: app.directory };
}

async function productionHosts() {
  const account = await accountId();
  const hosts = {};
  const add = (worker, host) => {
    hosts[worker] = [...(hosts[worker] ?? []), host];
  };
  for (const domain of await paged(`/accounts/${account}/workers/domains`))
    add(domain.service, domain.hostname);
  const zones = await api("/zones?name=gdgs.jp");
  for (const route of await api(`/zones/${zones[0].id}/workers/routes`)) {
    if (!route.script) continue;
    const [host, ...path] = route.pattern.split("/");
    if (path.join("/") !== "*" && path.length > 0)
      throw new Error(`Route ${route.pattern} has a path; staging maps hosts only`);
    add(route.script, host);
  }
  return hosts;
}

async function productionVars(worker) {
  const account = await accountId();
  const settings = await api(`/accounts/${account}/workers/scripts/${worker}/settings`);
  return Object.fromEntries(
    (settings.bindings ?? [])
      .filter(({ type }) => type === "plain_text" || type === "json")
      .map(({ name, text, json }) => [name, text ?? json]),
  );
}

async function inventory() {
  const account = await accountId();
  const d1 = Object.fromEntries(
    (await paged(`/accounts/${account}/d1/database`)).map(({ name, uuid }) => [name, uuid]),
  );
  const namespaces = await paged(`/accounts/${account}/storage/kv/namespaces`);
  const r2 = new Set(
    (await api(`/accounts/${account}/r2/buckets?per_page=1000`)).buckets.map(({ name }) => name),
  );
  const queues = new Set(
    (await paged(`/accounts/${account}/queues`)).map(({ queue_name }) => queue_name),
  );
  return {
    d1,
    kv: Object.fromEntries(namespaces.map(({ id, title }) => [title, id])),
    kvTitles: Object.fromEntries(namespaces.map(({ id, title }) => [id, title])),
    r2,
    queues,
  };
}

async function ensureResources(slot, apps) {
  const account = await accountId();
  const current = await inventory();
  for (const app of apps) {
    const needed = requiredResources(sourceConfig(app).config, slot);
    for (const name of needed.d1)
      if (!current.d1[name]) {
        log(`create D1 ${name}`);
        current.d1[name] = (
          await api(`/accounts/${account}/d1/database`, {
            method: "POST",
            body: { name },
          })
        ).uuid;
      }
    for (const productionId of needed.kv) {
      const title = stagingName(current.kvTitles[productionId], slot);
      if (!current.kv[title]) {
        log(`create KV ${title}`);
        const created = await api(`/accounts/${account}/storage/kv/namespaces`, {
          method: "POST",
          body: { title },
        });
        current.kv[title] = created.id;
        current.kvTitles[created.id] = title;
      }
    }
    for (const name of needed.r2)
      if (!current.r2.has(name)) {
        log(`create R2 ${name}`);
        await api(`/accounts/${account}/r2/buckets`, { method: "POST", body: { name } });
        current.r2.add(name);
      }
    for (const name of needed.queues)
      if (!current.queues.has(name)) {
        log(`create queue ${name}`);
        await api(`/accounts/${account}/queues`, { method: "POST", body: { queue_name: name } });
        current.queues.add(name);
      }
    for (const name of needed.aiSearchNamespaces) {
      const listed = wrangler(["ai-search", "namespace", "list"], { capture: true });
      if (!listed.includes(name)) {
        log(`create AI Search namespace ${name}`);
        wrangler(["ai-search", "namespace", "create", name]);
      }
    }
  }
  return current;
}

async function d1Query(databaseId, sql, params = []) {
  const account = await accountId();
  const result = await api(`/accounts/${account}/d1/database/${databaseId}/query`, {
    method: "POST",
    body: { sql, params },
  });
  return result[0]?.results ?? [];
}

async function exportDatabase(app, productionName, current, scratch) {
  const productionId = current.d1[productionName];
  if (!productionId) throw new Error(`Production D1 ${productionName} does not exist`);
  const schema = classifySchema(
    await d1Query(productionId, "SELECT type, name, tbl_name, sql FROM sqlite_master"),
  );
  const dataFile = join(scratch, `${productionName}.data.sql`);
  writeFileSync(dataFile, "");
  if (schema.tables.length)
    wrangler(
      [
        "d1",
        "export",
        productionName,
        "--remote",
        "--no-schema",
        ...schema.tables.flatMap(({ name }) => ["--table", name]),
        "--output",
        dataFile,
      ],
      { cwd: app.directory },
    );
  const virtualRows = {};
  for (const { name } of schema.virtualTables) {
    const rows = [];
    for (let after = -1; ; ) {
      const page = await d1Query(
        productionId,
        `SELECT rowid, * FROM "${name}" WHERE rowid > ? ORDER BY rowid LIMIT 500`,
        [after],
      );
      rows.push(...page);
      if (page.length < 500) break;
      after = page.at(-1).rowid;
    }
    virtualRows[name] = rows;
  }
  const importFile = join(scratch, `${productionName}.import.sql`);
  writeFileSync(
    importFile,
    composeImport({ schema, data: readFileSync(dataFile, "utf8"), virtualRows }),
  );
  rmSync(dataFile);
  return importFile;
}

async function replaceDatabase(app, productionName, importFile, slot, current) {
  const target = stagingName(productionName, slot);
  if (!isStagingName(target, slot)) throw new Error(`Refusing to replace ${target}`);
  const account = await accountId();
  if (current.d1[target]) {
    log(`replace D1 ${target}`);
    await api(`/accounts/${account}/d1/database/${current.d1[target]}`, { method: "DELETE" });
  }
  current.d1[target] = (
    await api(`/accounts/${account}/d1/database`, { method: "POST", body: { name: target } })
  ).uuid;
  wrangler(["d1", "execute", target, "--remote", "--file", importFile, "--yes"], {
    cwd: app.directory,
  });
  const postSync = POST_SYNC_SQL[productionName];
  if (postSync) await d1Query(current.d1[target], postSync(slot));
}

async function readNamespace(productionId) {
  const account = await accountId();
  const base = `/accounts/${account}/storage/kv/namespaces/${productionId}`;
  const entries = [];
  let cursor = "";
  do {
    const listed = await api(
      `${base}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { raw: true },
    );
    const now = Math.floor(Date.now() / 1000);
    const keys = listed.result.filter(({ expiration }) => !expiration || expiration > now + 60);
    for (let index = 0; index < keys.length; index += 100) {
      const batch = keys.slice(index, index + 100);
      const values = await api(`${base}/bulk/get`, {
        method: "POST",
        body: { keys: batch.map(({ name }) => name), withMetadata: true },
      });
      for (const { name, expiration } of batch) {
        const entry = values.values[name];
        if (entry === null || entry === undefined) continue;
        const value = typeof entry === "object" && "value" in entry ? entry.value : entry;
        entries.push({
          key: name,
          value: typeof value === "string" ? value : JSON.stringify(value),
          ...(expiration ? { expiration } : {}),
          ...(entry?.metadata ? { metadata: entry.metadata } : {}),
        });
      }
    }
    cursor = listed.result_info?.cursor ?? "";
  } while (cursor);
  return entries;
}

async function replaceNamespace(productionId, entries, slot, current) {
  const account = await accountId();
  const base = `/accounts/${account}/storage/kv/namespaces`;
  const title = stagingName(current.kvTitles[productionId], slot);
  if (!isStagingName(title, slot)) throw new Error(`Refusing to replace ${title}`);
  if (current.kv[title]) await api(`${base}/${current.kv[title]}`, { method: "DELETE" });
  const created = await api(base, { method: "POST", body: { title } });
  current.kv[title] = created.id;
  current.kvTitles[created.id] = title;
  for (let index = 0; index < entries.length; index += 5000)
    await api(`${base}/${created.id}/bulk`, {
      method: "PUT",
      body: entries.slice(index, index + 5000),
    });
  log(`copied ${entries.length} KV entries into ${title}`);
}

async function syncBuckets(names, slot) {
  if (!process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    log("::warning::R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY are not set; R2 objects were not copied");
    return;
  }
  const endpoint = `https://${await accountId()}.r2.cloudflarestorage.com`;
  for (const name of names)
    run(
      "aws",
      [
        "s3",
        "sync",
        `s3://${name}`,
        `s3://${stagingName(name, slot)}`,
        "--delete",
        "--only-show-errors",
        "--endpoint-url",
        endpoint,
      ],
      {
        env: {
          AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
          AWS_DEFAULT_REGION: "auto",
        },
      },
    );
}

export async function sync(slots, apps = stagingApps()) {
  for (const slot of slots) assertSlot(slot);
  let current;
  for (const slot of slots) current = await ensureResources(slot, apps);
  const scratch = mkdtempSync(join(tmpdir(), "gdgjp-staging-sync-"));
  try {
    for (const app of apps) {
      const config = sourceConfig(app).config;
      for (const { database_name } of config.d1_databases ?? []) {
        log(`export D1 ${database_name}`);
        const importFile = await exportDatabase(app, database_name, current, scratch);
        for (const slot of slots)
          await replaceDatabase(app, database_name, importFile, slot, current);
        rmSync(importFile);
      }
      for (const { id } of config.kv_namespaces ?? []) {
        const entries = await readNamespace(id);
        for (const slot of slots) await replaceNamespace(id, entries, slot, current);
      }
      const buckets = (config.r2_buckets ?? []).map(({ bucket_name }) => bucket_name);
      for (const slot of slots) await syncBuckets(buckets, slot);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function workerSecrets() {
  const raw = process.env.STAGING_WORKER_SECRETS;
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("STAGING_WORKER_SECRETS must be a JSON object keyed by production Worker");
  return parsed;
}

export async function stagingConfigs(slot, apps, current) {
  const hosts = await productionHosts();
  const workerNames = new Set(stagingApps().map(({ worker }) => worker));
  const resources = current ?? (await inventory());
  const configs = [];
  for (const app of apps) {
    const { config, directory } = sourceConfig(app);
    const extraVars = config.keep_vars ? await productionVars(app.worker) : {};
    const workerHosts = hosts[app.worker] ?? [];
    if (!workerHosts.length) throw new Error(`${app.worker} has no production domain or route`);
    configs.push({
      app,
      directory,
      config: rewriteWorkerConfig(config, {
        slot,
        hosts: workerHosts,
        resources,
        workerNames,
        extraVars,
      }),
    });
  }
  return configs;
}

function deployOne(slot, { app, directory, config }, secrets, { migrate = true } = {}) {
  const configPath = join(directory, `wrangler.${slot}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const scratch = mkdtempSync(join(tmpdir(), `gdgjp-${slot}-secrets-`));
  try {
    const args = ["deploy", "--config", configPath];
    const values = secrets[app.worker] ?? {};
    if (Object.keys(values).length) {
      const secretsPath = join(scratch, "secrets.json");
      writeFileSync(secretsPath, JSON.stringify(values), { mode: 0o600 });
      args.push("--secrets-file", secretsPath);
    }
    wrangler(args, { cwd: app.directory });
    for (const database of migrate ? app.migrateDatabases : [])
      wrangler(
        [
          "d1",
          "migrations",
          "apply",
          stagingName(database, slot),
          "--remote",
          "--config",
          configPath,
        ],
        { cwd: app.directory, env: { CI: "true" } },
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(configPath, { force: true });
  }
}

export async function deploy(slot, apps = stagingApps()) {
  assertSlot(slot);
  const current = await ensureResources(slot, apps);
  const configs = await stagingConfigs(slot, apps, current);
  const secrets = workerSecrets();
  const required = await productionSecretNames(apps);
  const incomplete = apps
    .map(({ worker }) => [worker, missingSecrets(required[worker], secrets[worker])])
    .filter(([, missing]) => missing.length);
  if (incomplete.length)
    throw new Error(
      `Staging would run production data without production secrets: ${incomplete
        .map(([worker, missing]) => `${worker} (${missing.join(", ")})`)
        .join("; ")}. Fill STAGING_WORKER_SECRETS from secrets-template.`,
    );
  const existing = await workerScripts();
  for (const entry of configs) {
    const missing = workerTargets(entry.config).filter((name) => !existing.has(name));
    if (!missing.length) continue;
    log(`bootstrap ${entry.config.name} without bindings to ${missing.join(", ")}`);
    deployOne(slot, { ...entry, config: withoutWorkerTargets(entry.config, missing) }, secrets, {
      migrate: false,
    });
    existing.add(entry.config.name);
  }
  let pending = configs;
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    const failed = [];
    for (const entry of pending) {
      log(`deploy ${entry.config.name} (attempt ${attempt})`);
      try {
        deployOne(slot, entry, secrets);
      } catch (error) {
        log(error.message);
        failed.push(entry);
      }
    }
    pending = failed;
  }
  if (pending.length)
    throw new Error(
      `Staging deploy failed for ${pending.map(({ config }) => config.name).join(", ")}`,
    );
}

export async function e2eEnvironment(slot, apps = stagingApps()) {
  assertSlot(slot);
  const byApp = Object.fromEntries(apps.map((app) => [app.app, app]));
  const appUrl = (name) => {
    const url = byApp[name]?.toml.vars?.APP_URL;
    if (!url) throw new Error(`${name} has no APP_URL`);
    return rewriteUrls(url, slot).replace(/\/+$/, "");
  };
  return {
    E2E_ACCOUNTS_URL: appUrl("accounts"),
    E2E_RP_URLS: RELYING_PARTY_APPS.map(appUrl).join(","),
    E2E_ACCOUNTS_D1: `remote:${stagingName("gdgjp-accounts-db", slot)}`,
  };
}

async function workerScripts() {
  const account = await accountId();
  return new Set((await api(`/accounts/${account}/workers/scripts`)).map(({ id }) => id));
}

async function productionSecretNames(apps) {
  const account = await accountId();
  const names = {};
  for (const app of apps)
    names[app.worker] = (
      await api(`/accounts/${account}/workers/scripts/${app.worker}/secrets`)
    ).map(({ name }) => name);
  return names;
}

export async function secretsTemplate(apps = stagingApps()) {
  const account = await accountId();
  const template = {};
  for (const app of apps) {
    const secrets = await api(`/accounts/${account}/workers/scripts/${app.worker}/secrets`);
    if (secrets.length)
      template[app.worker] = Object.fromEntries(secrets.map(({ name }) => [name, ""]));
  }
  return template;
}

export function build(apps = stagingApps()) {
  run("pnpm", ["--filter", "@gdgjp/design-system", "build"]);
  run("pnpm", [
    "exec",
    "turbo",
    "build",
    "--concurrency=4",
    ...apps.map(({ workspace }) => `--filter=${workspace}`),
  ]);
}

function selectApps(names) {
  const apps = stagingApps();
  if (!names) return apps;
  const wanted = new Set(names.split(","));
  const selected = apps.filter(({ app }) => wanted.has(app));
  if (selected.length !== wanted.size) throw new Error(`Unknown app in ${names}`);
  return selected;
}

async function main([command, ...args]) {
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const slot = option("slot");
  const apps = selectApps(option("apps"));
  if (command === "build") return build(apps);
  if (command === "sync") return sync(slot ? slot.split(",") : SLOTS, apps);
  if (command === "deploy") return deploy(assertSlot(slot), apps);
  if (command === "provision") return ensureResources(assertSlot(slot), apps);
  if (command === "plan") {
    process.stdout.write(
      `${JSON.stringify(await stagingConfigs(assertSlot(slot), apps), null, 2)}\n`,
    );
    return;
  }
  if (command === "e2e-env") {
    for (const [key, value] of Object.entries(await e2eEnvironment(assertSlot(slot), apps)))
      process.stdout.write(`${key}=${value}\n`);
    return;
  }
  if (command === "secrets-template") {
    process.stdout.write(`${JSON.stringify(await secretsTemplate(apps), null, 2)}\n`);
    return;
  }
  throw new Error(
    "Usage: node scripts/staging/staging.mjs <build|sync|deploy|provision|plan|e2e-env|secrets-template> --slot stg-N [--apps a,b]",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
