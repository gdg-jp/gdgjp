import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TRUSTED_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const API = "https://api.cloudflare.com/client/v4";
const WRANGLER = join(
  dirname(
    createRequire(join(TRUSTED_ROOT, "apps/accounts/package.json")).resolve(
      "wrangler/package.json",
    ),
  ),
  "bin/wrangler.js",
);

export function log(message) {
  process.stderr.write(`${message}\n`);
}

export function describeCommand(command, args) {
  const shown = [basename(command)];
  for (const arg of args) {
    if (arg.startsWith("-")) break;
    shown.push(arg);
  }
  return shown.join(" ");
}

export function run(command, args, { cwd = TRUSTED_ROOT, capture = false, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    stdio: [
      input === undefined ? "ignore" : "pipe",
      capture ? "pipe" : "inherit",
      capture ? "pipe" : "inherit",
    ],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...env },
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr}${result.stdout}` : "";
    throw new Error(`${describeCommand(command, args)} exited ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

export function wrangler(args, options = {}) {
  return run(process.execPath, [WRANGLER, ...args], options);
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

export async function api(path, { method = "GET", body, raw = false } = {}) {
  const { token } = cloudflare();
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((done) => setTimeout(done, attempt * 3000));
      continue;
    }
    if (response.status >= 500 && attempt < 4) {
      await new Promise((done) => setTimeout(done, attempt * 3000));
      continue;
    }
    const json = await response.json();
    if (!json.success)
      throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors ?? json)}`);
    return raw ? json : json.result;
  }
}

export async function accountId() {
  const current = cloudflare();
  if (!current.account) {
    const accounts = await api("/accounts");
    if (accounts.length !== 1)
      throw new Error("Set CLOUDFLARE_ACCOUNT_ID; the token can see several accounts");
    current.account = accounts[0].id;
  }
  return current.account;
}

export async function paged(path) {
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

export async function d1Query(databaseId, sql, params = []) {
  const account = await accountId();
  const result = await api(`/accounts/${account}/d1/database/${databaseId}/query`, {
    method: "POST",
    body: { sql, params },
  });
  return result[0]?.results ?? [];
}

export async function workersSubdomain() {
  return (await api(`/accounts/${await accountId()}/workers/subdomain`)).subdomain;
}
