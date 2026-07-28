import { CHAPTERS_SCOPE, CLI_SCOPE, requireUser } from "./auth.server";

export const DEVELOPER_CLIENT_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  CHAPTERS_SCOPE,
] as const;

export type DeveloperClientScope = (typeof DEVELOPER_CLIENT_SCOPES)[number];

export type DeveloperClient = {
  clientId: string;
  name: string;
  appUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: DeveloperClientScope[];
  disabled: boolean;
  createdAt: Date | string | number;
  updatedAt?: Date | string | number;
};

export type DeveloperClientInput = {
  name: string;
  appUrl?: string | null;
  redirectUris: string[];
  postLogoutRedirectUris?: string[];
  scopes?: string[];
};

export type DeveloperClientSecret = {
  client: DeveloperClient;
  clientSecret: string;
};

export type DeveloperClientValidationCode =
  | "invalid_name"
  | "invalid_app_url"
  | "invalid_redirect_uri"
  | "invalid_post_logout_redirect_uri"
  | "invalid_scope";

export class DeveloperClientValidationError extends Error {
  constructor(
    public readonly code: DeveloperClientValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "DeveloperClientValidationError";
  }
}

type DeveloperClientRow = {
  clientId: string;
  name: string | null;
  uri: string | null;
  redirectUris: string;
  postLogoutRedirectUris: string | null;
  scopes: string | null;
  disabled: number | boolean | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
};

type NormalizedDeveloperClientInput = {
  name: string;
  appUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: DeveloperClientScope[];
};

const MAX_NAME_LENGTH = 100;
const MAX_URI_LENGTH = 2048;
const MAX_URIS_PER_KIND = 10;
const CLI_CLIENT_ID = "gdg-cli";

export async function requireDeveloperAccess(env: Env, request: Request): Promise<{ id: string }> {
  const authorization = request.headers.get("Authorization");
  const user = authorization
    ? await requireCliTokenUser(env, authorization)
    : await requireUser(env, request);
  const membership = await env.DB.prepare(
    "SELECT 1 AS ok FROM memberships WHERE user_id = ? AND status = 'active' LIMIT 1",
  )
    .bind(user.id)
    .first<{ ok: number }>();
  if (membership?.ok !== 1) throw new Response("Forbidden", { status: 403 });
  return user;
}

export async function listDeveloperClients(env: Env, request: Request): Promise<DeveloperClient[]> {
  const user = await requireDeveloperAccess(env, request);
  const { results } = await env.DB.prepare(
    `${developerClientColumns()}
     WHERE userId = ?
     ORDER BY createdAt DESC, clientId`,
  )
    .bind(user.id)
    .all<DeveloperClientRow>();
  return results.map(toDeveloperClient);
}

export async function getDeveloperClient(
  env: Env,
  request: Request,
  clientId: string,
): Promise<DeveloperClient> {
  const user = await requireDeveloperAccess(env, request);
  return toDeveloperClient(await requireOwnedClient(env, user.id, clientId));
}

export async function createDeveloperClient(
  env: Env,
  request: Request,
  input: DeveloperClientInput,
): Promise<DeveloperClientSecret> {
  const user = await requireDeveloperAccess(env, request);
  const normalized = validateDeveloperClientInput(input);
  const clientId = crypto.randomUUID();
  const clientSecret = randomSecret();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO oauthClient (
       id, clientId, clientSecret, disabled, skipConsent, enableEndSession, subjectType, scopes,
       userId, createdAt, updatedAt, name, uri, redirectUris, postLogoutRedirectUris,
       tokenEndpointAuthMethod, grantTypes, responseTypes, public, type, requirePKCE
     ) VALUES (?, ?, ?, 0, 1, 1, 'public', ?, ?, ?, ?, ?, ?, ?, ?, 'client_secret_basic', ?, ?, 0, 'web', 1)`,
  )
    .bind(
      crypto.randomUUID(),
      clientId,
      await sha256Base64Url(clientSecret),
      JSON.stringify(normalized.scopes),
      user.id,
      now,
      now,
      normalized.name,
      normalized.appUrl,
      JSON.stringify(normalized.redirectUris),
      JSON.stringify(normalized.postLogoutRedirectUris),
      JSON.stringify(["authorization_code", "refresh_token"]),
      JSON.stringify(["code"]),
    )
    .run();

  return {
    client: await getOwnedClientDirect(env.DB, user.id, clientId),
    clientSecret,
  };
}

export async function updateDeveloperClient(
  env: Env,
  request: Request,
  clientId: string,
  input: DeveloperClientInput,
): Promise<DeveloperClient> {
  const user = await requireDeveloperAccess(env, request);
  const normalized = validateDeveloperClientInput(input);
  const current = await requireOwnedClient(env, user.id, clientId);
  const statements = [
    env.DB.prepare(
      `UPDATE oauthClient
     SET name = ?, uri = ?, redirectUris = ?, postLogoutRedirectUris = ?, scopes = ?,
         updatedAt = ?
     WHERE clientId = ? AND userId = ?`,
    ).bind(
      normalized.name,
      normalized.appUrl,
      JSON.stringify(normalized.redirectUris),
      JSON.stringify(normalized.postLogoutRedirectUris),
      JSON.stringify(normalized.scopes),
      new Date().toISOString(),
      clientId,
      user.id,
    ),
  ];
  if (!sameStringArray(parseStringArray(current.scopes), normalized.scopes)) {
    statements.push(
      env.DB.prepare("DELETE FROM oauthAccessToken WHERE clientId = ?").bind(clientId),
      env.DB.prepare("DELETE FROM oauthRefreshToken WHERE clientId = ?").bind(clientId),
    );
  }
  const [update] = await env.DB.batch(statements);
  if (update.meta.changes !== 1) throw notFound();
  return getOwnedClientDirect(env.DB, user.id, clientId);
}

export async function setDeveloperClientEnabled(
  env: Env,
  request: Request,
  clientId: string,
  enabled: boolean,
): Promise<DeveloperClient> {
  const user = await requireDeveloperAccess(env, request);
  await requireOwnedClient(env, user.id, clientId);
  const statements = [
    env.DB.prepare(
      "UPDATE oauthClient SET disabled = ?, updatedAt = ? WHERE clientId = ? AND userId = ?",
    ).bind(enabled ? 0 : 1, new Date().toISOString(), clientId, user.id),
  ];
  if (!enabled) {
    statements.push(
      env.DB.prepare("DELETE FROM oauthAccessToken WHERE clientId = ?").bind(clientId),
      env.DB.prepare("DELETE FROM oauthRefreshToken WHERE clientId = ?").bind(clientId),
    );
  }
  const [update] = await env.DB.batch(statements);
  if (update.meta.changes !== 1) throw notFound();
  return getOwnedClientDirect(env.DB, user.id, clientId);
}

export async function rotateDeveloperClientSecret(
  env: Env,
  request: Request,
  clientId: string,
): Promise<DeveloperClientSecret> {
  const user = await requireDeveloperAccess(env, request);
  await requireOwnedClient(env, user.id, clientId);
  const clientSecret = randomSecret();
  await env.DB.prepare(
    "UPDATE oauthClient SET clientSecret = ?, updatedAt = ? WHERE clientId = ? AND userId = ?",
  )
    .bind(await sha256Base64Url(clientSecret), new Date().toISOString(), clientId, user.id)
    .run();
  return {
    client: await getOwnedClientDirect(env.DB, user.id, clientId),
    clientSecret,
  };
}

export async function deleteDeveloperClient(
  env: Env,
  request: Request,
  clientId: string,
): Promise<void> {
  const user = await requireDeveloperAccess(env, request);
  await requireOwnedClient(env, user.id, clientId);
  await deleteOwnedClientDirect(env.DB, user.id, clientId);
}

export function validateDeveloperClientInput(
  input: DeveloperClientInput,
): NormalizedDeveloperClientInput {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new DeveloperClientValidationError(
      "invalid_name",
      `Application name must be between 1 and ${MAX_NAME_LENGTH} characters`,
    );
  }
  const appUrl = input.appUrl?.trim()
    ? normalizeSafeUrl(input.appUrl.trim(), "invalid_app_url")
    : null;
  const redirectUris = normalizeUriList(input.redirectUris, "invalid_redirect_uri", true);
  const postLogoutRedirectUris = normalizeUriList(
    input.postLogoutRedirectUris ?? [],
    "invalid_post_logout_redirect_uri",
    false,
  );
  const requestedScopes = new Set(input.scopes ?? [CHAPTERS_SCOPE]);
  requestedScopes.add("openid");
  for (const scope of requestedScopes) {
    if (!DEVELOPER_CLIENT_SCOPES.some((allowed) => allowed === scope)) {
      throw new DeveloperClientValidationError("invalid_scope", `Unsupported scope: ${scope}`);
    }
  }
  const scopes = DEVELOPER_CLIENT_SCOPES.filter((scope) => requestedScopes.has(scope));
  return { name, appUrl, redirectUris, postLogoutRedirectUris, scopes };
}

function normalizeUriList(
  values: string[],
  code: Extract<
    DeveloperClientValidationCode,
    "invalid_redirect_uri" | "invalid_post_logout_redirect_uri"
  >,
  required: boolean,
): string[] {
  if ((required && values.length === 0) || values.length > MAX_URIS_PER_KIND) {
    throw new DeveloperClientValidationError(
      code,
      `URI list must contain ${required ? "between 1 and" : "at most"} ${MAX_URIS_PER_KIND} entries`,
    );
  }
  const normalized = values.map((value) => normalizeSafeUrl(value.trim(), code));
  if (new Set(normalized).size !== normalized.length) {
    throw new DeveloperClientValidationError(code, "Duplicate URIs are not allowed");
  }
  return normalized;
}

function normalizeSafeUrl(value: string, code: DeveloperClientValidationCode): string {
  if (value.length === 0 || value.length > MAX_URI_LENGTH) {
    throw new DeveloperClientValidationError(code, "URI is empty or too long");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DeveloperClientValidationError(code, "URI is invalid");
  }
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new DeveloperClientValidationError(code, "URI must use HTTPS (HTTP is loopback-only)");
  }
  if (url.username || url.password || url.hash) {
    throw new DeveloperClientValidationError(code, "URI cannot contain credentials or a fragment");
  }
  const normalized = url.toString();
  if (normalized.length > MAX_URI_LENGTH) {
    throw new DeveloperClientValidationError(code, "URI is too long");
  }
  return normalized;
}

async function requireOwnedClient(
  env: Env,
  userId: string,
  clientId: string,
): Promise<DeveloperClientRow> {
  if (trustedClientIds(env).has(clientId)) throw notFound();
  const row = await env.DB.prepare(`${developerClientColumns()} WHERE clientId = ? AND userId = ?`)
    .bind(clientId, userId)
    .first<DeveloperClientRow>();
  if (!row) throw notFound();
  return row;
}

async function getOwnedClientDirect(
  db: D1Database,
  userId: string,
  clientId: string,
): Promise<DeveloperClient> {
  const row = await db
    .prepare(`${developerClientColumns()} WHERE clientId = ? AND userId = ?`)
    .bind(clientId, userId)
    .first<DeveloperClientRow>();
  if (!row) throw notFound();
  return toDeveloperClient(row);
}

async function deleteOwnedClientDirect(
  db: D1Database,
  userId: string,
  clientId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM oauthClient WHERE clientId = ? AND userId = ?")
    .bind(clientId, userId)
    .run();
}

function developerClientColumns(): string {
  return `SELECT clientId, name, uri, redirectUris, postLogoutRedirectUris, scopes,
                 disabled, createdAt, updatedAt
          FROM oauthClient`;
}

function toDeveloperClient(row: DeveloperClientRow): DeveloperClient {
  return {
    clientId: row.clientId,
    name: row.name ?? "",
    appUrl: row.uri,
    redirectUris: parseStringArray(row.redirectUris),
    postLogoutRedirectUris: parseStringArray(row.postLogoutRedirectUris),
    scopes: parseStringArray(row.scopes).filter((scope): scope is DeveloperClientScope =>
      DEVELOPER_CLIENT_SCOPES.some((allowed) => allowed === scope),
    ),
    disabled: row.disabled === true || row.disabled === 1,
    createdAt: row.createdAt ?? "",
    updatedAt: row.updatedAt ?? undefined,
  };
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function sameStringArray(left: string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function requireCliTokenUser(env: Env, authorization: string): Promise<{ id: string }> {
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
  if (!token) throw unauthorized();
  const row = await env.DB.prepare(
    `SELECT userId, scopes
     FROM oauthAccessToken
     WHERE token = ? AND clientId = ? AND expiresAt > ? AND userId IS NOT NULL
     LIMIT 1`,
  )
    .bind(token, CLI_CLIENT_ID, new Date().toISOString())
    .first<{ userId: string; scopes: string }>();
  if (!row || !hasScope(row.scopes, CLI_SCOPE)) throw unauthorized();
  return { id: row.userId };
}

function hasScope(value: string, required: string): boolean {
  try {
    const scopes: unknown = JSON.parse(value);
    return Array.isArray(scopes) && scopes.includes(required);
  } catch {
    return false;
  }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function trustedClientIds(env: Env): Set<string> {
  return new Set<string>(
    [
      env.TINYURL_CLIENT_ID,
      env.WIKI_CLIENT_ID,
      env.IMG_CLIENT_ID,
      env.SCHEDULER_CLIENT_ID,
      env.SNS_CLIENT_ID,
    ].filter(Boolean),
  );
}

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function unauthorized(): Response {
  return Response.json({ error: "invalid_token" }, { status: 401 });
}
