import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SLOTS, ZONE, hostLabel } from "./lib.mjs";

const API = "https://api.cloudflare.com/client/v4";
export const GITHUB_ORGANIZATION = "gdg-jp";
export const SERVICE_TOKEN_NAME = "gdgjp-staging-e2e";
export const IDENTITY_PROVIDER_NAME = "GitHub (gdg-jp)";

export function applicationName(slot) {
  return `GDG staging ${hostLabel(slot)}`;
}

export function slotDestinations(slot) {
  const site = `${hostLabel(slot)}.${ZONE}`;
  return [
    { type: "public", uri: `*.${site}` },
    { type: "public", uri: site },
  ];
}

export function applicationBody({ slot, identityProviderId, serviceTokenId }) {
  return {
    name: applicationName(slot),
    type: "self_hosted",
    domain: `*.${hostLabel(slot)}.${ZONE}`,
    destinations: slotDestinations(slot),
    session_duration: "24h",
    allowed_idps: [identityProviderId],
    auto_redirect_to_identity: true,
    app_launcher_visible: false,
    policies: [
      {
        name: "Staging CI service token",
        decision: "non_identity",
        include: [{ service_token: { token_id: serviceTokenId } }],
        precedence: 1,
      },
      {
        name: `Members of the ${GITHUB_ORGANIZATION} GitHub organization`,
        decision: "allow",
        include: [
          {
            github_organization: {
              name: GITHUB_ORGANIZATION,
              identity_provider_id: identityProviderId,
            },
          },
        ],
        precedence: 2,
      },
    ],
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("CLOUDFLARE_ACCESS_API_TOKEN")}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.success)
    throw new Error(`${method} ${path} failed: ${JSON.stringify(json.errors ?? json)}`);
  return json.result;
}

function storeGithubSecret(name, value) {
  const result = spawnSync(
    "gh",
    ["secret", "set", name, "--env", "staging", "--repo", "gdg-jp/gdgjp"],
    { input: value, encoding: "utf8", stdio: ["pipe", "ignore", "pipe"] },
  );
  if (result.status !== 0) throw new Error(`gh secret set ${name} failed: ${result.stderr}`);
}

async function ensureIdentityProvider(account) {
  const providers = await api(`/accounts/${account}/access/identity_providers`);
  const existing = providers.find(({ name }) => name === IDENTITY_PROVIDER_NAME);
  const body = {
    name: IDENTITY_PROVIDER_NAME,
    type: "github",
    config: {
      client_id: requireEnv("STAGING_ACCESS_GITHUB_CLIENT_ID"),
      client_secret: requireEnv("STAGING_ACCESS_GITHUB_CLIENT_SECRET"),
    },
  };
  if (existing) {
    await api(`/accounts/${account}/access/identity_providers/${existing.id}`, {
      method: "PUT",
      body,
    });
    return existing.id;
  }
  return (await api(`/accounts/${account}/access/identity_providers`, { method: "POST", body })).id;
}

async function ensureServiceToken(account) {
  const tokens = await api(`/accounts/${account}/access/service_tokens`);
  const existing = tokens.find(({ name }) => name === SERVICE_TOKEN_NAME);
  if (existing && !process.argv.includes("--rotate-service-token")) return existing.id;
  if (existing)
    await api(`/accounts/${account}/access/service_tokens/${existing.id}`, { method: "DELETE" });
  const created = await api(`/accounts/${account}/access/service_tokens`, {
    method: "POST",
    body: { name: SERVICE_TOKEN_NAME, duration: "8760h" },
  });
  storeGithubSecret("STAGING_ACCESS_CLIENT_ID", created.client_id);
  storeGithubSecret("STAGING_ACCESS_CLIENT_SECRET", created.client_secret);
  return created.id;
}

async function ensureApplication(account, slot, ids) {
  const apps = await api(`/accounts/${account}/access/apps`);
  const body = applicationBody({ slot, ...ids });
  const existing = apps.find(({ name }) => name === body.name);
  if (existing) {
    await api(`/accounts/${account}/access/apps/${existing.id}`, { method: "PUT", body });
    return existing.id;
  }
  return (await api(`/accounts/${account}/access/apps`, { method: "POST", body })).id;
}

export async function setup() {
  const account = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const organization = await api(`/accounts/${account}/access/organizations`);
  process.stdout.write(
    `GitHub OAuth callback: https://${organization.auth_domain}/cdn-cgi/access/callback\n`,
  );
  const identityProviderId = await ensureIdentityProvider(account);
  const serviceTokenId = await ensureServiceToken(account);
  for (const slot of SLOTS) {
    await ensureApplication(account, slot, { identityProviderId, serviceTokenId });
    process.stdout.write(
      `${applicationName(slot)}: ${slotDestinations(slot)
        .map(({ uri }) => uri)
        .join(", ")}\n`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  setup().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
