import { createHash, createHmac } from "node:crypto";

export const EXTERNAL_PREFIX = "STAGING_EXT__";

export const CONFIG_SECRETS = new Set(["AUTH_URL", "GDG_CLIENT_ID"]);

const SHARED = {
  AGENT_SERVICE_TOKEN: "shared:agent-service",
  GATEWAY_SHARED_SECRET: "shared:tinyurl-gateway",
};

const PER_WORKER = new Set([
  "BETTER_AUTH_SECRET",
  "RP_SESSION_SECRET",
  "RUNNER_TOKEN",
  "GATEWAY_TOKEN",
  "GOOGLE_PHOTOS_IMPORT_TOKEN",
  "GOOGLE_WORKSPACE_ENCRYPTION_KEY",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "SESSION_ENCRYPTION_KEY",
  "SETTINGS_ENCRYPTION_KEY",
  "AUTH_SECRET",
]);

const KEYRINGS = new Set(["TOKEN_ENCRYPTION_KEYS"]);

const LEGACY_CLIENT_SECRETS = {
  "gdgjp-img": { IMG_CLIENT_SECRET: "img", SCHEDULER_CLIENT_SECRET: "scheduler" },
  "gdgjp-scheduler": { SCHEDULER_CLIENT_SECRET: "scheduler" },
};

export const EXTERNAL_SECRETS = new Set([
  "AI_GATEWAY_TOKEN",
  "CF_ACCOUNT_ID",
  "CF_AE_API_TOKEN",
  "CONNPASS_BOT_EMAIL",
  "CONNPASS_BOT_PASSWORD",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "FCM_SERVICE_ACCOUNT_JSON",
  "GEMINI_API_KEY",
  "GITHUB_ACTIONS_DISPATCH_TOKEN",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CLOUD_PROJECT_NUMBER",
  "GOOGLE_DOCS_CLIENT_ID",
  "GOOGLE_DOCS_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_PHOTOS_CLIENT_ID",
  "GOOGLE_PHOTOS_CLIENT_SECRET",
  "GOOGLE_PICKER_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "LUMA_BOT_EMAIL",
  "LUMA_BOT_PASSWORD",
  "REALTIME_APP_TOKEN",
  "RESEND_API_KEY",
  "VERCEL_PROJECT_ID",
  "VERCEL_TEAM_ID",
  "VERCEL_TOKEN",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
]);

export function clientIdForSecret(name, worker, vars = {}) {
  if (name === "IDP_CLIENT_SECRET") return vars.IDP_CLIENT_ID ?? null;
  if (name === "GDG_CLIENT_SECRET") return "live-checkin";
  const legacy = LEGACY_CLIENT_SECRETS[worker]?.[name];
  if (legacy) return legacy;
  if (worker === "gdgjp-accounts") {
    const match = /^([A-Z0-9_]+)_CLIENT_SECRET$/.exec(name);
    if (match && name !== "GOOGLE_CLIENT_SECRET") {
      const id = vars[`${match[1]}_CLIENT_ID`];
      return id ?? match[1].toLowerCase().replaceAll("_", "-");
    }
  }
  return null;
}

export function classifySecret(name, worker, vars = {}) {
  if (CONFIG_SECRETS.has(name)) return { kind: "config" };
  if (EXTERNAL_SECRETS.has(name)) return { kind: "external" };
  if (SHARED[name]) return { kind: "derived", id: SHARED[name], format: "base64" };
  if (KEYRINGS.has(name)) return { kind: "derived", id: `${worker}:${name}`, format: "keyring" };
  const client = clientIdForSecret(name, worker, vars);
  if (client) return { kind: "derived", id: `client:${client}`, format: "base64" };
  if (PER_WORKER.has(name)) return { kind: "derived", id: `${worker}:${name}`, format: "base64" };
  return { kind: "unknown" };
}

export function deriveSecret(root, slot, id, format = "base64") {
  if (!root || root.length < 32)
    throw new Error("STAGING_ROOT_SECRET must be at least 32 characters");
  const material = createHmac("sha256", root).update(`${slot}\0${id}`).digest();
  const value = material.toString("base64");
  return format === "keyring" ? JSON.stringify({ 1: value }) : value;
}

export function hashClientSecret(secret) {
  return createHash("sha256").update(secret).digest("base64url");
}

export function externalKey(worker, name) {
  return `${EXTERNAL_PREFIX}${worker
    .replace(/^gdgjp-/, "")
    .replaceAll("-", "_")
    .toUpperCase()}__${name}`;
}

export function externalValues(worker, allSecrets = {}) {
  const prefix = externalKey(worker, "");
  return Object.fromEntries(
    Object.entries(allSecrets)
      .filter(([key, value]) => key.startsWith(prefix) && typeof value === "string" && value)
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

export function stagingSecretsFor({
  worker,
  slot,
  productionSecrets,
  vars,
  root,
  external,
  config,
}) {
  const secrets = {};
  const unknown = [];
  const missingExternal = [];
  for (const name of productionSecrets) {
    const rule = classifySecret(name, worker, vars);
    if (rule.kind === "unknown") unknown.push(name);
    else if (rule.kind === "config") {
      if (config?.[name] === undefined) unknown.push(name);
      else secrets[name] = config[name];
    } else if (rule.kind === "derived")
      secrets[name] = deriveSecret(root, slot, rule.id, rule.format);
    else if (external[name] !== undefined) secrets[name] = external[name];
    else missingExternal.push(name);
  }
  const varOverrides = {};
  for (const [name, value] of Object.entries(external))
    if (!productionSecrets.includes(name)) varOverrides[name] = value;
  return {
    secrets,
    varOverrides,
    unknown: unknown.sort(),
    missingExternal: missingExternal.sort(),
  };
}
