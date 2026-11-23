export const SLOTS = ["stg-1", "stg-2", "stg-3"];
export const ZONE = "gdgs.jp";
export const EXCLUDED_APPS = new Set();
export const LABEL_PATTERN = /^deploy-(stg-[1-3])$/;

const IDENTIFIER_PATHS = /^\/(?:scopes|claims)\//;

export const STAGING_VAR_DEFAULTS = {
  "gdgjp-meet": { CALENDAR_SEND_UPDATES: "none" },
  "gdgjp-accounts": { EMAIL_FROM: "GDG Japan Staging <onboarding@resend.dev>" },
  "gdgjp-pay": { EMAIL_FROM: "GDG Japan Pay Staging <onboarding@resend.dev>" },
};

export function assertSlot(slot) {
  if (!SLOTS.includes(slot)) throw new Error(`Unknown staging slot: ${slot}`);
  return slot;
}

export function slotFromLabel(label) {
  return LABEL_PATTERN.exec(label ?? "")?.[1] ?? null;
}

export function stagingName(name, slot) {
  assertSlot(slot);
  if (!name) throw new Error("Cannot derive a staging name from an empty name");
  if (name.endsWith(`-${slot}`)) throw new Error(`${name} is already a ${slot} resource`);
  return `${name}-${slot}`;
}

export function hostLabel(slot) {
  return assertSlot(slot).replace("-", "");
}

export function isStagingName(name, slot) {
  return typeof name === "string" && name.endsWith(`-${assertSlot(slot)}`);
}

export function stagingHost(host, slot) {
  assertSlot(slot);
  const lower = host.toLowerCase();
  const label = hostLabel(slot);
  if (lower === ZONE) return `${label}.${ZONE}`;
  if (lower.endsWith(`.${ZONE}`)) return `${lower.slice(0, -ZONE.length)}${label}.${ZONE}`;
  return host;
}

export function rewriteUrls(value, slot) {
  assertSlot(slot);
  return value.replace(
    /\b(https?:\/\/)((?:[a-z0-9-]+\.)*gdgs\.jp)(?=[/:?#,"'\s]|$)(\/[^\s,"'?#]*)?/gi,
    (match, scheme, host, path = "") =>
      IDENTIFIER_PATHS.test(path) ? match : `${scheme}${stagingHost(host, slot)}${path}`,
  );
}

function rewriteVarValue(value, slot) {
  if (typeof value === "string") return rewriteUrls(value, slot);
  if (Array.isArray(value)) return value.map((entry) => rewriteVarValue(entry, slot));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, rewriteVarValue(entry, slot)]),
    );
  return value;
}

function isEmpty(value) {
  if (value === undefined || value === null || value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmpty);
  return false;
}

const PASSTHROUGH = new Set([
  "$schema",
  "alias",
  "assets",
  "base_dir",
  "browser",

  "compatibility_date",
  "compatibility_flags",
  "configPath",
  "definedEnvironments",
  "dev",
  "find_additional_modules",
  "images",
  "jsx_factory",
  "jsx_fragment",
  "keep_vars",
  "limits",
  "main",
  "migrations",
  "minify",
  "no_bundle",
  "observability",
  "placement",
  "preserve_file_names",
  "python_modules",
  "rules",
  "topLevelName",
  "tsconfig",
  "upload_source_maps",
  "userConfigPath",
  "ai",
  "version_metadata",
]);

const REWRITTEN = new Set([
  "name",
  "vars",
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "queues",
  "services",
  "durable_objects",
  "workflows",
  "analytics_engine_datasets",
  "ai_search_namespaces",
  "triggers",
  "routes",
  "route",
  "workers_dev",
  "preview_urls",
  "tail_consumers",
  "env",
]);

function renameService(service, slot, workerNames, owner) {
  if (!workerNames.has(service))
    throw new Error(
      `${owner}: binding to ${service}, which has no staging copy, would reach production`,
    );
  return stagingName(service, slot);
}

export function rewriteWorkerConfig(
  config,
  { slot, hosts, resources, workerNames, extraVars, varOverrides },
) {
  assertSlot(slot);
  for (const [key, value] of Object.entries(config)) {
    if (PASSTHROUGH.has(key) || REWRITTEN.has(key)) continue;
    if (!isEmpty(value))
      throw new Error(`${config.name}: staging does not know how to isolate "${key}"`);
  }
  const output = {};
  for (const [key, value] of Object.entries(config))
    if ((PASSTHROUGH.has(key) || isEmpty(value)) && key !== "env" && key !== "route")
      output[key] = value;
  output.name = stagingName(config.name, slot);
  output.vars = {
    ...rewriteVarValue({ ...(extraVars ?? {}), ...(config.vars ?? {}) }, slot),
    ...(STAGING_VAR_DEFAULTS[config.name] ?? {}),
    ...(varOverrides ?? {}),
    STAGING_SLOT: slot,
  };
  output.workers_dev = false;
  output.preview_urls = false;
  output.triggers = { crons: [...(config.triggers?.crons ?? [])] };
  output.routes = [...new Set(hosts.map((host) => stagingHost(host, slot)))]
    .sort()
    .map((pattern) => ({ pattern, custom_domain: true }));
  output.d1_databases = (config.d1_databases ?? []).map((database) => {
    const name = stagingName(database.database_name, slot);
    const id = resources.d1[name];
    if (!id) throw new Error(`${config.name}: staging D1 database ${name} does not exist`);
    const { preview_database_id: _preview, remote: _remote, ...rest } = database;
    return { ...rest, database_name: name, database_id: id };
  });
  output.kv_namespaces = (config.kv_namespaces ?? []).map((namespace) => {
    const title = resources.kvTitles[namespace.id];
    if (!title) throw new Error(`${config.name}: production KV ${namespace.id} has no title`);
    const name = stagingName(title, slot);
    const id = resources.kv[name];
    if (!id) throw new Error(`${config.name}: staging KV namespace ${name} does not exist`);
    const { preview_id: _preview, remote: _remote, ...rest } = namespace;
    return { ...rest, id };
  });
  output.r2_buckets = (config.r2_buckets ?? []).map((bucket) => {
    const { preview_bucket_name: _preview, remote: _remote, ...rest } = bucket;
    return { ...rest, bucket_name: stagingName(bucket.bucket_name, slot) };
  });
  output.queues = {
    producers: (config.queues?.producers ?? []).map((producer) => ({
      ...producer,
      queue: stagingName(producer.queue, slot),
    })),
    consumers: (config.queues?.consumers ?? []).map((consumer) => ({
      ...consumer,
      queue: stagingName(consumer.queue, slot),
      ...(consumer.dead_letter_queue
        ? { dead_letter_queue: stagingName(consumer.dead_letter_queue, slot) }
        : {}),
    })),
  };
  output.services = (config.services ?? []).map(({ remote: _remote, ...service }) => ({
    ...service,
    service: renameService(service.service, slot, workerNames, config.name),
  }));
  output.durable_objects = {
    bindings: (config.durable_objects?.bindings ?? []).map((binding) =>
      binding.script_name
        ? {
            ...binding,
            script_name: renameService(binding.script_name, slot, workerNames, config.name),
          }
        : binding,
    ),
  };
  output.workflows = (config.workflows ?? []).map((workflow) => ({
    ...workflow,
    name: stagingName(workflow.name, slot),
    ...(workflow.script_name
      ? { script_name: renameService(workflow.script_name, slot, workerNames, config.name) }
      : {}),
  }));
  output.analytics_engine_datasets = (config.analytics_engine_datasets ?? []).map((dataset) => ({
    ...dataset,
    dataset: stagingName(dataset.dataset ?? dataset.binding, slot),
  }));
  output.ai_search_namespaces = (config.ai_search_namespaces ?? []).map(
    ({ remote: _remote, ...namespace }) => ({
      ...namespace,
      namespace: stagingName(namespace.namespace, slot),
    }),
  );
  output.tail_consumers = (config.tail_consumers ?? []).map((consumer) => ({
    ...consumer,
    service: renameService(consumer.service, slot, workerNames, config.name),
  }));
  return output;
}

export function requiredResources(config, slot) {
  return {
    d1: (config.d1_databases ?? []).map(({ database_name }) => stagingName(database_name, slot)),
    kv: (config.kv_namespaces ?? []).map(({ id }) => id),
    r2: (config.r2_buckets ?? []).map(({ bucket_name }) => stagingName(bucket_name, slot)),
    queues: [
      ...new Set(
        [...(config.queues?.producers ?? []), ...(config.queues?.consumers ?? [])].flatMap(
          ({ queue, dead_letter_queue }) =>
            [queue, dead_letter_queue].filter(Boolean).map((name) => stagingName(name, slot)),
        ),
      ),
    ],
    aiSearchNamespaces: (config.ai_search_namespaces ?? []).map(({ namespace }) =>
      stagingName(namespace, slot),
    ),
  };
}

const FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];

export function classifySchema(rows) {
  const objects = rows.filter(
    ({ name }) => !name.startsWith("sqlite_") && !name.startsWith("_cf_"),
  );
  const virtualTables = objects.filter(
    ({ type, sql }) => type === "table" && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql ?? ""),
  );
  const shadow = new Set(
    virtualTables.flatMap(({ name }) => FTS_SHADOW_SUFFIXES.map((suffix) => `${name}${suffix}`)),
  );
  const tables = objects.filter(
    ({ type, name, sql }) =>
      type === "table" && !shadow.has(name) && !virtualTables.some((vt) => vt.name === name) && sql,
  );
  return {
    tables,
    virtualTables,
    indexes: objects.filter(({ type, sql }) => type === "index" && sql),
    views: objects.filter(({ type }) => type === "view"),
    triggers: objects.filter(({ type }) => type === "trigger"),
  };
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Cannot encode ${value} as SQL`);
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function statement(sql) {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function composeImport({ schema, data, virtualRows }) {
  const parts = ["PRAGMA defer_foreign_keys=TRUE;"];
  for (const table of schema.tables) parts.push(statement(table.sql));
  parts.push(data.replace(/^PRAGMA defer_foreign_keys=TRUE;\s*/i, "").trim());
  for (const table of schema.virtualTables) {
    parts.push(statement(table.sql));
    for (const row of virtualRows[table.name] ?? []) {
      const columns = Object.keys(row);
      parts.push(
        `INSERT INTO "${table.name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`,
      );
    }
  }
  for (const group of [schema.indexes, schema.views, schema.triggers])
    for (const object of group) parts.push(statement(object.sql));
  return `${parts.filter(Boolean).join("\n")}\n`;
}

export function oauthRedirectRewriteSql(slot) {
  assertSlot(slot);
  const label = hostLabel(slot);
  const rewrite = (column) =>
    `replace(replace(${column}, '.${ZONE}', '.${label}.${ZONE}'), '//${ZONE}', '//${label}.${ZONE}')`;
  return [
    `UPDATE "oauthClient" SET "redirectUris" = ${rewrite('"redirectUris"')},`,
    `"postLogoutRedirectUris" = ${rewrite('"postLogoutRedirectUris"')}`,
    `WHERE "redirectUris" LIKE '%${ZONE}%' OR "postLogoutRedirectUris" LIKE '%${ZONE}%';`,
  ].join(" ");
}

export function relyingPartyUrls(slot, hostsByWorker, relyingParties) {
  return relyingParties
    .map((worker) => {
      const host = hostsByWorker[worker]?.find((candidate) => candidate.endsWith(`.${ZONE}`));
      if (!host) throw new Error(`${worker} has no production host to test`);
      return `https://${stagingHost(host, slot)}`;
    })
    .sort();
}

export function workerTargets(config) {
  return [
    ...new Set(
      [
        ...(config.services ?? []).map(({ service }) => service),
        ...(config.durable_objects?.bindings ?? []).map(({ script_name }) => script_name),
        ...(config.workflows ?? []).map(({ script_name }) => script_name),
        ...(config.tail_consumers ?? []).map(({ service }) => service),
      ].filter((name) => name && name !== config.name),
    ),
  ].sort();
}

export function withoutWorkerTargets(config, names) {
  const drop = new Set(names);
  return {
    ...config,
    services: (config.services ?? []).filter(({ service }) => !drop.has(service)),
    durable_objects: {
      bindings: (config.durable_objects?.bindings ?? []).filter(
        ({ script_name }) => !drop.has(script_name),
      ),
    },
    workflows: (config.workflows ?? []).filter(({ script_name }) => !drop.has(script_name)),
    tail_consumers: (config.tail_consumers ?? []).filter(({ service }) => !drop.has(service)),
  };
}
