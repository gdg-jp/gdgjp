// RFC 8628 (OAuth 2.0 Device Authorization Grant) support around the vendored
// @better-auth/oauth-provider plugin, which only implements
// authorization_code/client_credentials/refresh_token. Both entry points here
// are called from api.auth.$.ts before it falls through to runAuthHandler,
// mirroring how developer-oauth-api.server.ts intercepts client-management
// paths ahead of the plugin.
//
// Access/refresh tokens are never written to D1. On approve we only persist
// the one-time authorization_code the plugin mints; the token endpoint
// exchanges that code for real tokens at poll time and streams the result
// straight through, so a leaked or abandoned row never holds a live
// credential for longer than that single code's own short lifetime.

import { AUTH_IP_ADDRESS_HEADERS } from "./auth.server";
import { normalizeUserCode } from "./user-code";

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const DEVICE_CODE_TTL_SECONDS = 600;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INCREMENT_SECONDS = 5;
// Excludes 0/O/1/I/L so a user reading the code aloud or typing it by hand
// can't confuse characters.
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const USER_CODE_LENGTH = 8;
// Bounds how many device logins can sit unresolved at once. Expired rows are
// swept on every device_authorization request, so these are effectively caps
// within a rolling DEVICE_CODE_TTL_SECONDS window, not a lifetime total.
export const MAX_PENDING_DEVICE_CODES_PER_CLIENT = 20;
export const MAX_PENDING_DEVICE_CODES_PER_IP = 5;

type DeviceCodeRow = {
  id: string;
  clientId: string;
  scope: string;
  codeVerifier: string;
  status: "pending" | "denied" | "completed";
  userId: string | null;
  intervalSeconds: number;
  lastPolledAt: string | null;
  expiresAt: string;
};

export type PendingDeviceCode = {
  id: string;
  clientId: string;
  clientName: string;
  scope: string;
};

export async function handleDeviceAuthorizationRequest(
  env: Env,
  request: Request,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const now = new Date();
  // The only cleanup path for abandoned logins (CLI killed, user never
  // submits the code): sweep whatever has aged out on every request to this
  // endpoint rather than relying on someone polling that exact device_code.
  await env.DB.prepare("DELETE FROM oauthDeviceCode WHERE expiresAt <= ?")
    .bind(now.toISOString())
    .run();

  const form = await request.formData().catch(() => null);
  const clientId = form ? String(form.get("client_id") ?? "") : "";
  if (!clientId) return tokenErrorResponse(400, "invalid_request", "client_id is required");

  const client = await env.DB.prepare(
    "SELECT clientId, disabled, grantTypes, scopes FROM oauthClient WHERE clientId = ? LIMIT 1",
  )
    .bind(clientId)
    .first<{
      clientId: string;
      disabled: number | null;
      grantTypes: string | null;
      scopes: string | null;
    }>();
  if (!client || client.disabled) {
    return tokenErrorResponse(400, "invalid_client", "unknown or disabled client");
  }
  if (!parseStringArray(client.grantTypes).includes(DEVICE_GRANT_TYPE)) {
    return tokenErrorResponse(
      400,
      "unauthorized_client",
      "client is not authorized to use the device_code grant",
    );
  }

  const pendingForClient = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM oauthDeviceCode WHERE clientId = ? AND status = 'pending'",
  )
    .bind(clientId)
    .first<{ count: number }>();
  if ((pendingForClient?.count ?? 0) >= MAX_PENDING_DEVICE_CODES_PER_CLIENT) {
    return tokenErrorResponse(
      429,
      "temporarily_unavailable",
      "too many pending device logins for this client",
    );
  }

  const ip = clientIp(request);
  const ipHash = ip ? await sha256Base64Url(ip) : null;
  if (ipHash) {
    const pendingForIp = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM oauthDeviceCode WHERE ipHash = ? AND status = 'pending'",
    )
      .bind(ipHash)
      .first<{ count: number }>();
    if ((pendingForIp?.count ?? 0) >= MAX_PENDING_DEVICE_CODES_PER_IP) {
      return tokenErrorResponse(
        429,
        "temporarily_unavailable",
        "too many pending device logins from this address",
      );
    }
  }

  const allowedScopes = parseStringArray(client.scopes);
  const requestedScopes = String(form?.get("scope") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  const scope = (
    requestedScopes.length > 0
      ? requestedScopes.filter((s) => allowedScopes.includes(s))
      : allowedScopes
  ).join(" ");

  const deviceCode = randomToken(32);
  const userCode = randomUserCode();
  const codeVerifier = randomToken(48);
  const expiresAt = new Date(now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000);

  await env.DB.prepare(
    `INSERT INTO oauthDeviceCode (
       id, deviceCodeHash, userCodeHash, clientId, scope, codeVerifier, status,
       intervalSeconds, expiresAt, createdAt, ipHash
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      await sha256Base64Url(deviceCode),
      await sha256Base64Url(normalizeUserCode(userCode)),
      clientId,
      scope,
      codeVerifier,
      DEFAULT_POLL_INTERVAL_SECONDS,
      expiresAt.toISOString(),
      now.toISOString(),
      ipHash,
    )
    .run();

  const verificationUri = `${trimTrailing(env.APP_URL)}/device`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

  return Response.json(
    {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: DEFAULT_POLL_INTERVAL_SECONDS,
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

/**
 * Handles POST /api/auth/oauth2/token when grant_type is the device-code
 * URN. Returns null (unhandled) for every other grant type so the caller can
 * forward the original, untouched request to the plugin.
 */
export async function handleDeviceTokenGrant(
  env: Env,
  request: Request,
  runAuthHandler: (env: Env, request: Request) => Promise<Response>,
): Promise<Response | null> {
  const peek = request.clone();
  const form = await peek.formData().catch(() => null);
  if (!form || form.get("grant_type") !== DEVICE_GRANT_TYPE) return null;

  const deviceCode = String(form.get("device_code") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  if (!deviceCode || !clientId) {
    return tokenErrorResponse(400, "invalid_request", "device_code and client_id are required");
  }

  const deviceCodeHash = await sha256Base64Url(deviceCode);
  const row = await env.DB.prepare(
    `SELECT id, clientId, scope, codeVerifier, status, userId,
            intervalSeconds, lastPolledAt, expiresAt
     FROM oauthDeviceCode
     WHERE deviceCodeHash = ? AND clientId = ?
     LIMIT 1`,
  )
    .bind(deviceCodeHash, clientId)
    .first<DeviceCodeRow>();
  if (!row)
    return tokenErrorResponse(400, "expired_token", "device_code is invalid or has expired");

  const now = new Date();
  if (new Date(row.expiresAt).getTime() <= now.getTime()) {
    await env.DB.prepare("DELETE FROM oauthDeviceCode WHERE id = ?").bind(row.id).run();
    return tokenErrorResponse(400, "expired_token", "device_code has expired");
  }

  if (
    row.lastPolledAt &&
    now.getTime() - new Date(row.lastPolledAt).getTime() < row.intervalSeconds * 1000
  ) {
    const nextInterval = row.intervalSeconds + SLOW_DOWN_INCREMENT_SECONDS;
    await env.DB.prepare(
      "UPDATE oauthDeviceCode SET intervalSeconds = ?, lastPolledAt = ? WHERE id = ?",
    )
      .bind(nextInterval, now.toISOString(), row.id)
      .run();
    return tokenErrorResponse(400, "slow_down", "polling too frequently");
  }
  await env.DB.prepare("UPDATE oauthDeviceCode SET lastPolledAt = ? WHERE id = ?")
    .bind(now.toISOString(), row.id)
    .run();

  if (row.status === "pending") {
    return tokenErrorResponse(
      400,
      "authorization_pending",
      "the user has not yet approved this device",
    );
  }
  if (row.status === "denied") {
    await env.DB.prepare("DELETE FROM oauthDeviceCode WHERE id = ?").bind(row.id).run();
    return tokenErrorResponse(400, "access_denied", "the user denied the request");
  }

  // completed: claim and delete in one statement so two overlapping polls
  // can't both read the same one-time authorization code.
  const claimed = await env.DB.prepare(
    `DELETE FROM oauthDeviceCode WHERE id = ? AND status = 'completed'
     RETURNING clientId, scope, codeVerifier, authorizationCode`,
  )
    .bind(row.id)
    .first<{
      clientId: string;
      scope: string;
      codeVerifier: string;
      authorizationCode: string | null;
    }>();
  if (!claimed || !claimed.authorizationCode) {
    return tokenErrorResponse(400, "invalid_grant", "device_code has already been used");
  }

  const redirectUri = await lookupRedirectUri(env, claimed.clientId);
  if (!redirectUri) return tokenErrorResponse(500, "server_error", "token issuance failed");

  const tokenForm = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: claimed.clientId,
    code: claimed.authorizationCode,
    redirect_uri: redirectUri,
    code_verifier: claimed.codeVerifier,
  });
  const tokenResponse = await runAuthHandler(
    env,
    new Request(new URL("/api/auth/oauth2/token", env.APP_URL), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenForm.toString(),
    }),
  );
  if (!tokenResponse.ok) return tokenErrorResponse(500, "server_error", "token issuance failed");

  return new Response(await tokenResponse.text(), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

/** Looks up a pending device code by its user-facing code for the /device verification page. */
export async function findPendingDeviceCodeByUserCode(
  env: Env,
  userCode: string,
): Promise<PendingDeviceCode | null> {
  const userCodeHash = await sha256Base64Url(normalizeUserCode(userCode));
  const row = await env.DB.prepare(
    `SELECT d.id AS id, d.clientId AS clientId, d.scope AS scope, c.name AS clientName
     FROM oauthDeviceCode d
     JOIN oauthClient c ON c.clientId = d.clientId
     WHERE d.userCodeHash = ? AND d.status = 'pending' AND d.expiresAt > ?
     LIMIT 1`,
  )
    .bind(userCodeHash, new Date().toISOString())
    .first<{ id: string; clientId: string; scope: string; clientName: string | null }>();
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName ?? row.clientId,
    scope: row.scope,
  };
}

/** Marks a pending device code denied. No-op if it was already resolved. */
export async function denyDeviceCode(env: Env, id: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE oauthDeviceCode SET status = 'denied' WHERE id = ? AND status = 'pending'",
  )
    .bind(id)
    .run();
}

/**
 * Approves a pending device code: drives the plugin's own
 * authorization_code + PKCE grant in-process (using the caller's session
 * cookie) so token minting stays inside the already-tested plugin code, then
 * stores only the resulting one-time authorization_code for the token
 * endpoint to exchange on the CLI's next poll. Access/refresh tokens are
 * never written to D1. Returns false if the row was already resolved or the
 * bridge failed; the row is left untouched (still pending) so the user can
 * retry.
 */
export async function approveDeviceCode(
  env: Env,
  request: Request,
  id: string,
  userId: string,
  runAuthHandler: (env: Env, request: Request) => Promise<Response>,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT id, clientId, scope, codeVerifier, status, expiresAt
     FROM oauthDeviceCode WHERE id = ? AND status = 'pending' AND expiresAt > ? LIMIT 1`,
  )
    .bind(id, new Date().toISOString())
    .first<
      Pick<DeviceCodeRow, "id" | "clientId" | "scope" | "codeVerifier" | "status" | "expiresAt">
    >();
  if (!row) return false;

  const redirectUri = await lookupRedirectUri(env, row.clientId);
  if (!redirectUri) return false;

  const codeChallenge = await sha256Base64Url(row.codeVerifier);
  const authorizeUrl = new URL("/api/auth/oauth2/authorize", env.APP_URL);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", row.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", row.scope);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", randomToken(16));

  const authorizeResponse = await runAuthHandler(
    env,
    new Request(authorizeUrl, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        accept: "application/json",
      },
    }),
  );
  if (!authorizeResponse.ok) return false;

  let authorizeResult: { redirect?: boolean; url?: string };
  try {
    authorizeResult = (await authorizeResponse.json()) as { redirect?: boolean; url?: string };
  } catch {
    // The plugin returned a non-JSON body (e.g. an HTML login page) instead
    // of the { redirect, url } shape we asked for via Accept: application/json.
    return false;
  }
  const code = authorizeResult.url ? new URL(authorizeResult.url).searchParams.get("code") : null;
  if (!code) return false;

  const update = await env.DB.prepare(
    "UPDATE oauthDeviceCode SET status = 'completed', userId = ?, authorizationCode = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(userId, code, id)
    .run();
  return update.meta.changes === 1;
}

async function lookupRedirectUri(env: Env, clientId: string): Promise<string | null> {
  const client = await env.DB.prepare(
    "SELECT redirectUris FROM oauthClient WHERE clientId = ? LIMIT 1",
  )
    .bind(clientId)
    .first<{ redirectUris: string | null }>();
  return parseStringArray(client?.redirectUris)[0] ?? null;
}

function clientIp(request: Request): string | null {
  for (const header of AUTH_IP_ADDRESS_HEADERS) {
    const value = request.headers.get(header)?.split(",")[0]?.trim();
    if (value) return value;
  }
  return null;
}

function tokenErrorResponse(status: number, error: string, description: string): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function randomUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function randomToken(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
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

function trimTrailing(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
