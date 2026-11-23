import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSlot, stagingName } from "./lib.mjs";

export const DURABLE_OBJECT_APPS = ["wiki", "screen", "ost", "mc", "deck"];
export const SNAPSHOT_ENTRYPOINT = "StagingSnapshot";
export const COMPATIBILITY_DATE = "2026-07-28";
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

function bindingKey(app) {
  return app.toUpperCase().replaceAll("-", "_");
}

export function snapshotWorkerName(slot) {
  return `gdgjp-staging-snapshot-${assertSlot(slot)}`;
}

export function durableObjectWorkers(apps, slot) {
  assertSlot(slot);
  return apps
    .filter(({ app }) => DURABLE_OBJECT_APPS.includes(app))
    .map(({ app, worker }) => ({ app, production: worker, staging: stagingName(worker, slot) }));
}

export function snapshotWorkerSource() {
  return `const DEFAULT_PAGE_SIZE = ${DEFAULT_PAGE_SIZE};
const MAX_PAGE_SIZE = ${MAX_PAGE_SIZE};
const encoder = new TextEncoder();

function json(body, status = 200) {
  return Response.json(body, { status });
}

function authorized(request, token) {
  if (typeof token !== "string" || !token) return false;
  const supplied = encoder.encode(request.headers.get("Authorization") ?? "");
  const expected = encoder.encode(\`Bearer \${token}\`);
  return (
    supplied.byteLength === expected.byteLength &&
    crypto.subtle.timingSafeEqual(supplied, expected)
  );
}

function count(value, fallback, max) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/sync") return json({ error: "not_found" }, 404);
    if (!authorized(request, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => null);
    const app = typeof body?.app === "string" ? body.app : "";
    const key = app.toUpperCase().replaceAll("-", "_");
    const production = env[\`PROD_\${key}\`];
    const staging = env[\`STG_\${key}\`];
    if (!app || !production || !staging) return json({ error: "unknown_app", app }, 400);
    const offset = count(body.offset, 0, Number.MAX_SAFE_INTEGER);
    const limit = Math.max(1, count(body.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
    const instances = await production.instances();
    const page = instances.slice(offset, offset + limit);
    const failed = [];
    let copied = 0;
    for (const { binding, name } of page) {
      try {
        const snapshot = await production.exportInstance(binding, name);
        await staging.importInstance(binding, name, snapshot);
        copied += 1;
      } catch (error) {
        failed.push({ binding, name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const end = offset + page.length;
    return json({
      app,
      total: instances.length,
      offset,
      copied,
      failed,
      next: end < instances.length ? end : null,
    });
  },
};
`;
}

export function snapshotWorkerConfig({ slot, workers }) {
  assertSlot(slot);
  const seen = new Set();
  const services = workers.flatMap(({ app, production, staging }) => {
    if (!DURABLE_OBJECT_APPS.includes(app))
      throw new Error(`${app} does not export a ${SNAPSHOT_ENTRYPOINT} entrypoint`);
    if (seen.has(app)) throw new Error(`${app} is listed twice`);
    seen.add(app);
    if (staging !== stagingName(production, slot))
      throw new Error(`${staging} is not the ${slot} copy of ${production}`);
    return [
      { binding: `PROD_${bindingKey(app)}`, service: production, entrypoint: SNAPSHOT_ENTRYPOINT },
      { binding: `STG_${bindingKey(app)}`, service: staging, entrypoint: SNAPSHOT_ENTRYPOINT },
    ];
  });
  return {
    name: snapshotWorkerName(slot),
    main: "index.mjs",
    compatibility_date: COMPATIBILITY_DATE,
    workers_dev: true,
    preview_urls: false,
    services,
  };
}

export function workerUrl(name, deployOutput, accountSubdomain) {
  if (accountSubdomain) return `https://${name}.${accountSubdomain}.workers.dev`;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`https://${escaped}\\.[a-z0-9-]+\\.workers\\.dev`, "i").exec(
    deployOutput ?? "",
  );
  if (!match) throw new Error(`Could not find the workers.dev URL of ${name} in wrangler output`);
  return match[0];
}

async function postSync({ url, token, body, fetchImpl, sleep, attempts }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(`${url}/sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) return JSON.parse(text);
      lastError = new Error(
        `POST /sync ${body.app} returned ${response.status}: ${text.slice(0, 300)}`,
      );
      if (response.status === 400) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(attempt * 2000);
  }
  throw lastError;
}

export async function syncDurableObjects({
  slot,
  workers,
  runWrangler,
  log = () => {},
  fetchImpl = fetch,
  accountSubdomain,
  pageSize = DEFAULT_PAGE_SIZE,
  attempts = 6,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const config = snapshotWorkerConfig({ slot, workers });
  if (!config.services.length) return [];
  const token = randomBytes(32).toString("base64url");
  const scratch = mkdtempSync(join(tmpdir(), `gdgjp-${slot}-snapshot-`));
  const configPath = join(scratch, "wrangler.json");
  const secretsPath = join(scratch, "secrets.json");
  writeFileSync(join(scratch, config.main), snapshotWorkerSource());
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeFileSync(secretsPath, JSON.stringify({ SYNC_TOKEN: token }), { mode: 0o600 });
  let deployAttempted = false;
  try {
    log(`deploy ${config.name}`);
    deployAttempted = true;
    const output = runWrangler(["deploy", "--config", configPath, "--secrets-file", secretsPath], {
      capture: true,
    });
    rmSync(secretsPath, { force: true });
    const url = workerUrl(config.name, output, accountSubdomain);
    const results = [];
    for (const { app } of workers) {
      const result = { app, total: 0, copied: 0, failed: [] };
      for (let offset = 0; offset !== null; ) {
        const page = await postSync({
          url,
          token,
          body: { app, offset, limit: pageSize },
          fetchImpl,
          sleep,
          attempts,
        });
        result.total = page.total;
        result.copied += page.copied;
        result.failed.push(...page.failed);
        log(`${app}: ${offset + page.copied + page.failed.length}/${page.total} Durable Objects`);
        offset = page.next;
      }
      results.push(result);
    }
    const failed = results.flatMap(({ app, failed }) =>
      failed.map(({ binding, name, error }) => `${app} ${binding}/${name}: ${error}`),
    );
    if (failed.length)
      throw new Error(`Durable Object sync into ${slot} failed:\n${failed.join("\n")}`);
    return results;
  } finally {
    try {
      if (deployAttempted) {
        log(`delete ${config.name}`);
        runWrangler(["delete", config.name, "--config", configPath, "--force"]);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
