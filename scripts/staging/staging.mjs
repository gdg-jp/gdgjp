import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { DEPLOY_TARGETS } from "../../.github/scripts/changed-workspaces.mjs";
import {
  TRUSTED_ROOT,
  accountId,
  api,
  d1Query,
  log,
  paged,
  run,
  workersSubdomain,
  wrangler,
} from "./cloudflare.mjs";
import { durableObjectWorkers, syncDurableObjects } from "./durable-objects.mjs";
import {
  EXCLUDED_APPS,
  SLOTS,
  assertSlot,
  classifySchema,
  composeImport,
  isStagingName,
  issuerColumns,
  issuerRewriteSql,
  oauthRedirectRewriteSql,
  orderInserts,
  planInsertOrder,
  requiredResources,
  rewriteUrls,
  rewriteWorkerConfig,
  stagingHost,
  stagingName,
  withoutWorkerTargets,
  workerTargets,
} from "./lib.mjs";
import { copyBuckets } from "./r2-copy.mjs";
import { rehearseImport } from "./rehearse.mjs";
import { UNCOPIED_KV_TITLES, firstPartyClientSql, scrubPlan } from "./scrub.mjs";
import {
  clientIdForSecret,
  deriveSecret,
  externalKey,
  externalValues,
  hashClientSecret,
  stagingSecretsFor,
} from "./secrets.mjs";

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

const BUNDLE_DIRECTORY = ".staging-bundle";
const COMPATIBILITY_DATE = "2026-07-25";
const SOURCE = resolve(process.env.STAGING_SOURCE ?? TRUSTED_ROOT);

export function parseJsonc(text) {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      output += char;
      if (char === "\\") output += text[++index] ?? "";
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++;
      output += "\n";
    } else if (char === "/" && text[index + 1] === "*") {
      index = text.indexOf("*/", index + 2) + 1;
      if (index === 0) throw new Error("Unterminated comment in JSONC");
    } else output += char;
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/g, "$1"));
}

function readBaseConfig(directory) {
  const toml = join(directory, "wrangler.toml");
  if (existsSync(toml)) return parseToml(readFileSync(toml, "utf8"));
  return parseJsonc(readFileSync(join(directory, "wrangler.jsonc"), "utf8"));
}

export function stagingApps(source = SOURCE) {
  return DEPLOY_TARGETS.filter(
    ({ provider, app }) => provider === "cloudflare" && !EXCLUDED_APPS.has(app),
  ).map(({ app, workspace }) => {
    const directory = join(source, "apps", app);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    const base = readBaseConfig(directory);
    const migrateDatabases = [
      ...(manifest.scripts?.["migrate:remote"] ?? "").matchAll(/d1 migrations apply (\S+)/g),
    ].map((match) => match[1]);
    return { app, workspace, directory, worker: base.name, base, migrateDatabases };
  });
}

function bundleEntry(directory) {
  const bundle = join(directory, BUNDLE_DIRECTORY);
  if (!existsSync(bundle)) return null;
  const entries = readdirSync(bundle).filter((file) => /\.m?js$/.test(file));
  if (entries.length !== 1) throw new Error(`${bundle} must contain exactly one module`);
  return `${BUNDLE_DIRECTORY}/${entries[0]}`;
}

export function sourceConfig(app, { requireBuild = true } = {}) {
  const built = join(app.directory, "build/server/wrangler.json");
  if (existsSync(built))
    return {
      config: JSON.parse(readFileSync(built, "utf8")),
      directory: join(app.directory, "build/server"),
    };
  const entry = bundleEntry(app.directory);
  if (entry)
    return {
      config: {
        ...app.base,
        main: entry,
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
      },
      directory: app.directory,
    };
  if (requireBuild) throw new Error(`${app.app} has no build output; run the staging build first`);
  return { config: app.base, directory: app.directory };
}

export function build(apps = stagingApps()) {
  run("pnpm", ["--filter", "@gdgjp/design-system", "build"], { cwd: SOURCE });
  const workspaces = apps
    .filter(({ app }) => app !== "live-checkin")
    .map(({ workspace }) => `--filter=${workspace}`);
  if (workspaces.length)
    run("pnpm", ["exec", "turbo", "build", "--concurrency=4", ...workspaces], { cwd: SOURCE });
  for (const app of apps) {
    if (existsSync(join(app.directory, "build/server/wrangler.json"))) continue;
    if (app.app === "live-checkin")
      run("pnpm", ["exec", "opennextjs-cloudflare", "build"], { cwd: app.directory });
    rmSync(join(app.directory, BUNDLE_DIRECTORY), { recursive: true, force: true });
    run("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "--outdir", BUNDLE_DIRECTORY], {
      cwd: app.directory,
    });
    for (const file of readdirSync(join(app.directory, BUNDLE_DIRECTORY))) {
      if (/\.m?js$/.test(file)) continue;
      if (!/\.map$|^README\.md$/.test(file))
        throw new Error(
          `${app.app} bundles an additional module ${file}; teach the staging build to ship it`,
        );
      rmSync(join(app.directory, BUNDLE_DIRECTORY, file));
    }
  }
}

function removeUntrustedEnvironment(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const path = join(directory, entry);
    if (/^\.env(\..*)?$|^\.dev\.vars/.test(entry) || entry === ".vercel")
      rmSync(path, { recursive: true, force: true });
    else if (statSync(path).isDirectory()) removeUntrustedEnvironment(path);
  }
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

async function productionSecretNames(workers) {
  const account = await accountId();
  const names = {};
  for (const worker of workers)
    names[worker] = (await api(`/accounts/${account}/workers/scripts/${worker}/secrets`)).map(
      ({ name }) => name,
    );
  return names;
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

function aiSearch(args) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return wrangler(["ai-search", ...args], { capture: true });
    } catch (error) {
      if (!/10429|Rate limited/.test(error.message) || attempt === 5) {
        log(error.message.split("\n").find((line) => /code: \d+/.test(line)) ?? error.message);
        return null;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 10000);
    }
  }
  return null;
}

async function ensureResources(slot, apps) {
  const account = await accountId();
  const current = await inventory();
  let aiSearchNamespaces;
  for (const app of apps) {
    const needed = requiredResources(sourceConfig(app, { requireBuild: false }).config, slot);
    for (const name of needed.d1)
      if (!current.d1[name]) {
        log(`create D1 ${name}`);
        current.d1[name] = (
          await api(`/accounts/${account}/d1/database`, { method: "POST", body: { name } })
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
      aiSearchNamespaces ??= aiSearch(["namespace", "list"]);
      if (aiSearchNamespaces === null) {
        current.aiSearchUnavailable = true;
        log(
          `::warning::this token cannot use AI Search; ${name} is not bound and Wiki search is off in ${slot}`,
        );
        continue;
      }
      if (!aiSearchNamespaces.includes(name)) {
        log(`create AI Search namespace ${name}`);
        if (aiSearch(["namespace", "create", name]) === null)
          throw new Error(`Could not create AI Search namespace ${name}`);
        aiSearchNamespaces += `\n${name}`;
      }
    }
  }
  return current;
}

function rootSecret() {
  const root = process.env.STAGING_ROOT_SECRET;
  if (!root) throw new Error("STAGING_ROOT_SECRET is required");
  return root;
}

function allExternalSecrets() {
  const raw = process.env.STAGING_SECRETS_JSON;
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("STAGING_SECRETS_JSON must be a JSON object");
  return parsed;
}

function hostOf(apps, name, slot) {
  const url = apps.find(({ app }) => app === name)?.base.vars?.APP_URL;
  return url ? new URL(rewriteUrls(url, slot)).host : stagingHost(`${name}.gdgs.jp`, slot);
}

async function accountsPostSync(slot, apps) {
  const root = rootSecret();
  const accounts =
    apps.find(({ app }) => app === "accounts") ??
    stagingApps().find(({ app }) => app === "accounts");
  const { "gdgjp-accounts": names } = await productionSecretNames(["gdgjp-accounts"]);
  const clients = names
    .map((name) => clientIdForSecret(name, "gdgjp-accounts", accounts.base.vars))
    .filter(Boolean)
    .map((clientId) => ({
      clientId,
      secretHash: hashClientSecret(deriveSecret(root, slot, `client:${clientId}`)),
    }));
  const checkin = stagingHost("checkin.gdgs.jp", slot);
  const checkinHash = hashClientSecret(deriveSecret(root, slot, "client:live-checkin"));
  return [
    oauthRedirectRewriteSql(slot),
    ...firstPartyClientSql(clients),
    `UPDATE "oauthClient" SET "clientSecret" = '${checkinHash}' WHERE "redirectUris" LIKE '%//${checkin}/%';`,
  ];
}

async function tableColumns(databaseId, tables) {
  const columns = {};
  for (const { name } of tables)
    columns[name] = (
      await d1Query(databaseId, "SELECT name FROM pragma_table_info(?)", [name])
    ).map((row) => row.name);
  return columns;
}

async function exportDatabase(app, productionName, current, scratch) {
  const productionId = current.d1[productionName];
  if (!productionId) throw new Error(`Production D1 ${productionName} does not exist`);
  const schema = classifySchema(
    await d1Query(productionId, "SELECT type, name, tbl_name, sql FROM sqlite_master"),
  );
  const columns = await tableColumns(productionId, schema.tables);
  const plan = scrubPlan(productionName, columns);
  const info = {};
  for (const { name } of schema.tables)
    info[name] = {
      keys: await d1Query(
        productionId,
        'SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)',
        [name],
      ),
      columns: await d1Query(productionId, 'SELECT name, "notnull", pk FROM pragma_table_info(?)', [
        name,
      ]),
    };
  const insertPlan = planInsertOrder(
    schema.tables.map(({ name }) => name),
    info,
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
      { cwd: scratch },
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
    composeImport({
      schema,
      data: orderInserts(readFileSync(dataFile, "utf8"), insertPlan),
      virtualRows,
    }),
  );
  rmSync(dataFile);
  return { importFile, scrub: plan.statements, issuers: issuerColumns(columns) };
}

async function replaceDatabase(
  productionName,
  { importFile, scrub, issuers = [] },
  slot,
  current,
  apps,
  scratch,
) {
  const target = stagingName(productionName, slot);
  if (!isStagingName(target, slot)) throw new Error(`Refusing to replace ${target}`);
  const account = await accountId();
  const tail = [
    ...scrub,
    ...issuerRewriteSql(issuers, slot),
    ...(productionName === "gdgjp-accounts-db" ? await accountsPostSync(slot, apps) : []),
  ];
  const slotFile = join(scratch, `${target}.sql`);
  const sql = `${readFileSync(importFile, "utf8")}${tail.join("\n")}\n`;
  rehearseImport(sql, target);
  writeFileSync(slotFile, sql);
  if (current.d1[target]) {
    log(`replace D1 ${target}`);
    await api(`/accounts/${account}/d1/database/${current.d1[target]}`, { method: "DELETE" });
  }
  current.d1[target] = (
    await api(`/accounts/${account}/d1/database`, { method: "POST", body: { name: target } })
  ).uuid;
  try {
    wrangler(["d1", "execute", target, "--remote", "--file", slotFile, "--yes"], { cwd: scratch });
  } finally {
    rmSync(slotFile, { force: true });
  }
}

export async function rehearse(apps = stagingApps()) {
  const account = await accountId();
  const d1 = Object.fromEntries(
    (await paged(`/accounts/${account}/d1/database`)).map(({ name, uuid }) => [name, uuid]),
  );
  const scratch = mkdtempSync(join(tmpdir(), "gdgjp-staging-rehearse-"));
  try {
    for (const app of apps)
      for (const { database_name } of sourceConfig(app, { requireBuild: false }).config
        .d1_databases ?? []) {
        const { importFile, scrub } = await exportDatabase(app, database_name, { d1 }, scratch);
        rehearseImport(`${readFileSync(importFile, "utf8")}${scrub.join("\n")}\n`, database_name);
        log(`rehearsed ${database_name}`);
      }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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

export async function sync(slots, apps = stagingApps()) {
  for (const slot of slots) assertSlot(slot);
  rootSecret();
  let current;
  for (const slot of slots) current = await ensureResources(slot, apps);
  const scratch = mkdtempSync(join(tmpdir(), "gdgjp-staging-sync-"));
  try {
    for (const app of apps) {
      const config = sourceConfig(app, { requireBuild: false }).config;
      for (const { database_name } of config.d1_databases ?? []) {
        log(`export D1 ${database_name}`);
        const exported = await exportDatabase(app, database_name, current, scratch);
        for (const slot of slots)
          await replaceDatabase(database_name, exported, slot, current, apps, scratch);
        rmSync(exported.importFile);
      }
      for (const { id } of config.kv_namespaces ?? []) {
        const entries = UNCOPIED_KV_TITLES.has(current.kvTitles[id]) ? [] : await readNamespace(id);
        for (const slot of slots) await replaceNamespace(id, entries, slot, current);
      }
    }
    const buckets = [
      ...new Set(
        apps.flatMap(
          (app) =>
            sourceConfig(app, { requireBuild: false }).config.r2_buckets?.map(
              ({ bucket_name }) => bucket_name,
            ) ?? [],
        ),
      ),
    ];
    const subdomain = await workersSubdomain();
    for (const slot of slots)
      await copyBuckets({
        name: `gdgjp-staging-r2-copy-${slot}`,
        pairs: buckets.map((source) => ({ source, target: stagingName(source, slot) })),
        compatibilityDate: COMPATIBILITY_DATE,
        subdomain,
        runWrangler: wrangler,
        log,
      });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function syncDurableObjectsInto(slots, apps = stagingApps()) {
  const existing = await workerScripts();
  for (const slot of slots) {
    const workers = durableObjectWorkers(apps, slot).filter(({ staging }) => {
      if (existing.has(staging)) return true;
      log(`::warning::${staging} is not deployed; its Durable Objects were not copied`);
      return false;
    });
    await syncDurableObjects({ slot, workers, runWrangler: wrangler, log });
  }
}

async function configSecrets(app, slot, current) {
  if (app.app !== "live-checkin") return {};
  const checkin = stagingHost("checkin.gdgs.jp", slot);
  const database = current.d1[stagingName("gdgjp-accounts-db", slot)];
  const [client] = database
    ? await d1Query(
        database,
        `SELECT "clientId" FROM "oauthClient" WHERE "redirectUris" LIKE ? LIMIT 1`,
        [`%//${checkin}/%`],
      )
    : [];
  return {
    AUTH_URL: `https://${checkin}`,
    ...(client ? { GDG_CLIENT_ID: client.clientId } : {}),
  };
}

export async function secretPlan(slot, apps, current) {
  const root = rootSecret();
  const external = allExternalSecrets();
  const names = await productionSecretNames(apps.map(({ worker }) => worker));
  const plans = {};
  for (const app of apps) {
    const plan = stagingSecretsFor({
      worker: app.worker,
      slot,
      productionSecrets: names[app.worker],
      vars: app.base.vars ?? {},
      root,
      external: externalValues(app.worker, external),
      config: await configSecrets(app, slot, current),
    });
    if (plan.unknown.length)
      throw new Error(
        `${app.worker} has production secrets with no staging rule: ${plan.unknown.join(", ")}. Classify them in scripts/staging/secrets.mjs.`,
      );
    for (const name of plan.missingExternal)
      log(
        `::warning::${app.worker}: ${name} has no staging value; set the ${externalKey(app.worker, name)} secret`,
      );
    plans[app.worker] = plan;
  }
  return plans;
}

export async function stagingConfigs(slot, apps, current, plans = {}) {
  const hosts = await productionHosts();
  const workerNames = new Set(stagingApps().map(({ worker }) => worker));
  const resources = current ?? (await inventory());
  const configs = [];
  for (const app of apps) {
    const { config, directory } = sourceConfig(app, { requireBuild: !!plans[app.worker] });
    const extraVars = config.keep_vars ? await productionVars(app.worker) : {};
    const workerHosts = hosts[app.worker] ?? [];
    if (!workerHosts.length) throw new Error(`${app.worker} has no production domain or route`);
    configs.push({
      app,
      directory,
      config: rewriteWorkerConfig(
        resources.aiSearchUnavailable ? { ...config, ai_search_namespaces: [] } : config,
        {
          slot,
          hosts: workerHosts,
          resources,
          workerNames,
          extraVars,
          varOverrides: plans[app.worker]?.varOverrides,
        },
      ),
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
    if (Object.keys(secrets).length) {
      const secretsPath = join(scratch, "secrets.json");
      writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
      args.push("--secrets-file", secretsPath);
    }
    wrangler(args, { cwd: directory });
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
        { cwd: directory, env: { CI: "true" } },
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(configPath, { force: true });
  }
}

async function workerScripts() {
  const account = await accountId();
  return new Set((await api(`/accounts/${account}/workers/scripts`)).map(({ id }) => id));
}

function deployGateway(slot) {
  const worker = "gdgjp-tinyurl-gateway";
  const external = externalValues(worker, allExternalSecrets());
  const missing = ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"].filter(
    (name) => !external[name],
  );
  if (missing.length) {
    log(
      `::warning::${worker} was not deployed; set ${missing.map((name) => externalKey(worker, name)).join(", ")}`,
    );
    return;
  }
  const vercel = createRequire(join(TRUSTED_ROOT, "apps/tinyurl-gateway/package.json")).resolve(
    "vercel/dist/vc.js",
  );
  const shared = deriveSecret(rootSecret(), slot, "shared:tinyurl-gateway");
  run(
    process.execPath,
    [
      vercel,
      "deploy",
      join(SOURCE, "apps/tinyurl-gateway"),
      "--yes",
      "--token",
      external.VERCEL_TOKEN,
      "--env",
      `TINYURL_INTERNAL_BASE=https://${stagingHost("url.gdgs.jp", slot)}`,
      "--env",
      `GATEWAY_SHARED_SECRET=${shared}`,
    ],
    {
      cwd: SOURCE,
      env: { VERCEL_ORG_ID: external.VERCEL_ORG_ID, VERCEL_PROJECT_ID: external.VERCEL_PROJECT_ID },
    },
  );
}

export async function deploy(slot, apps = stagingApps()) {
  assertSlot(slot);
  if (SOURCE !== TRUSTED_ROOT) removeUntrustedEnvironment(join(SOURCE, "apps"));
  const current = await ensureResources(slot, apps);
  const plans = await secretPlan(slot, apps, current);
  const configs = await stagingConfigs(slot, apps, current, plans);
  const existing = await workerScripts();
  for (const entry of configs) {
    const missing = workerTargets(entry.config).filter((name) => !existing.has(name));
    if (!missing.length) continue;
    log(`bootstrap ${entry.config.name} without bindings to ${missing.join(", ")}`);
    try {
      deployOne(
        slot,
        { ...entry, config: withoutWorkerTargets(entry.config, missing) },
        plans[entry.app.worker].secrets,
        { migrate: false },
      );
      existing.add(entry.config.name);
    } catch (error) {
      log(error.message);
    }
  }
  let pending = configs;
  for (let attempt = 1; attempt <= 3 && pending.length; attempt++) {
    if (attempt > 1) await new Promise((done) => setTimeout(done, attempt * 20000));
    const failed = [];
    for (const entry of pending) {
      log(`deploy ${entry.config.name} (attempt ${attempt})`);
      try {
        deployOne(slot, entry, plans[entry.app.worker].secrets);
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
  deployGateway(slot);
}

export function e2eEnvironment(slot, apps = stagingApps()) {
  assertSlot(slot);
  const appUrl = (name) => `https://${hostOf(apps, name, slot)}`;
  const root = process.env.STAGING_ROOT_SECRET;
  return {
    E2E_ACCOUNTS_URL: appUrl("accounts"),
    E2E_RP_URLS: RELYING_PARTY_APPS.map(appUrl).join(","),
    E2E_ACCOUNTS_D1: `remote:${stagingName("gdgjp-accounts-db", slot)}`,
    ...(root
      ? { E2E_BETTER_AUTH_SECRET: deriveSecret(root, slot, "gdgjp-accounts:BETTER_AUTH_SECRET") }
      : {}),
  };
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
  if (command === "sync-durable-objects")
    return syncDurableObjectsInto(slot ? slot.split(",") : SLOTS, apps);
  if (command === "deploy") return deploy(assertSlot(slot), apps);
  if (command === "provision") return ensureResources(assertSlot(slot), apps);
  if (command === "rehearse") return rehearse(apps);
  if (command === "plan") {
    const configs = await stagingConfigs(assertSlot(slot), apps);
    process.stdout.write(
      `${JSON.stringify(
        configs.map(({ config }) => config),
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (command === "e2e-env") {
    const environment = e2eEnvironment(assertSlot(slot), apps);
    if (args.includes("--github-env")) {
      if (environment.E2E_BETTER_AUTH_SECRET)
        process.stdout.write(`::add-mask::${environment.E2E_BETTER_AUTH_SECRET}\n`);
      writeFileSync(
        process.env.GITHUB_ENV,
        Object.entries(environment)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
        { flag: "a" },
      );
      return;
    }
    for (const [key, value] of Object.entries(environment))
      if (key !== "E2E_BETTER_AUTH_SECRET") process.stdout.write(`${key}=${value}\n`);
    return;
  }
  if (command === "hosts") {
    for (const app of apps)
      process.stdout.write(`${app.app} https://${hostOf(apps, app.app, assertSlot(slot))}\n`);
    return;
  }
  throw new Error(
    "Usage: node scripts/staging/staging.mjs <build|sync|sync-durable-objects|deploy|provision|rehearse|plan|e2e-env|hosts> --slot stg-N [--apps a,b]",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
