// Additive Google Workspace OAuth linking: incremental-consent state/PKCE,
// encrypted refresh-token storage, and the Google token endpoints the
// oauth.google-workspace.* routes and api.agents.google-workspace-token.ts
// route call into. See docs/agents-local-gws/01-accounts-workspace-link.md.
//
// This is deliberately independent of auth.server.ts / Better Auth: it talks
// to Google's OAuth endpoints directly (incremental authorization on the same
// GCP client) rather than going through signInSocial, and stores its own
// state/connection rows rather than touching Better Auth's `account` table.

export const GOOGLE_WORKSPACE_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];
export const WORKSPACE_STATE_TTL_SECONDS = 600;
export const TOKEN_VEND_RATE_LIMIT_WINDOW_SECONDS = 60;
export const TOKEN_VEND_RATE_LIMIT_MAX = 20;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Bumped only when a new GOOGLE_WORKSPACE_ENCRYPTION_KEY_V<n> secret is
// introduced. Rotation procedure: add the new secret, add a `case n:` below,
// bump this constant so new writes use it — existing rows stay on their
// recorded encryptionKeyVersion and are re-encrypted the next time their row
// is written (reconnect), not in place.
const CURRENT_ENCRYPTION_KEY_VERSION = 1;

function encryptionKeySecret(env: Env, version: number): string {
  switch (version) {
    case 1:
      return env.GOOGLE_WORKSPACE_ENCRYPTION_KEY;
    default:
      throw new Error(`unsupported Google Workspace encryption key version ${version}`);
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomToken(bytes: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function trimTrailing(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function pkceChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

// --- Encryption -------------------------------------------------------

export async function encryptRefreshToken(
  env: Env,
  userId: string,
  refreshToken: string,
): Promise<{ ciphertext: string; nonce: string; keyVersion: number }> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encryptionKeySecret(env, CURRENT_ENCRYPTION_KEY_VERSION)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(userId) },
    key,
    new TextEncoder().encode(refreshToken),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    nonce: bytesToBase64Url(nonce),
    keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
  };
}

export async function decryptRefreshToken(
  env: Env,
  userId: string,
  keyVersion: number,
  ciphertext: string,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encryptionKeySecret(env, keyVersion)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(nonce),
      additionalData: new TextEncoder().encode(userId),
    },
    key,
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

// --- Incremental-consent state (PKCE + CSRF state) ---------------------

export function workspaceRedirectUri(env: Env): string {
  return `${trimTrailing(env.APP_URL)}/oauth/google-workspace/callback`;
}

export function workspaceAuthorizeUrl(env: Env, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: workspaceRedirectUri(env),
    response_type: "code",
    scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function sweepExpiredWorkspaceOauthState(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare("DELETE FROM googleWorkspaceOauthState WHERE expiresAt <= ?")
    .bind(now.toISOString())
    .run();
}

export type WorkspaceOauthStart = { state: string; codeChallenge: string };

export async function createWorkspaceOauthState(
  db: D1Database,
  userId: string,
  returnTo: string,
): Promise<WorkspaceOauthStart> {
  const now = new Date();
  await sweepExpiredWorkspaceOauthState(db, now);
  const state = randomToken(32);
  const codeVerifier = randomToken(48);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const expiresAt = new Date(now.getTime() + WORKSPACE_STATE_TTL_SECONDS * 1000);
  await db
    .prepare(
      `INSERT INTO googleWorkspaceOauthState (id, userId, codeVerifier, returnTo, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(state, userId, codeVerifier, returnTo, now.toISOString(), expiresAt.toISOString())
    .run();
  return { state, codeChallenge };
}

type WorkspaceOauthStateRow = {
  userId: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: string;
};

export type ConsumedWorkspaceOauthState =
  | { ok: true; userId: string; codeVerifier: string; returnTo: string }
  | { ok: false; reason: "not_found" | "expired" | "session_mismatch" };

/**
 * Single-use: the row is deleted on the first lookup regardless of outcome,
 * so a replayed `state` (valid or not) always reports "not_found" on the
 * second attempt.
 */
export async function consumeWorkspaceOauthState(
  db: D1Database,
  state: string,
  sessionUserId: string,
): Promise<ConsumedWorkspaceOauthState> {
  const row = await db
    .prepare(
      "DELETE FROM googleWorkspaceOauthState WHERE id = ? RETURNING userId, codeVerifier, returnTo, expiresAt",
    )
    .bind(state)
    .first<WorkspaceOauthStateRow>();
  if (!row) return { ok: false, reason: "not_found" };
  if (new Date(row.expiresAt).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (row.userId !== sessionUserId) return { ok: false, reason: "session_mismatch" };
  return { ok: true, userId: row.userId, codeVerifier: row.codeVerifier, returnTo: row.returnTo };
}

// --- Google token endpoint calls ---------------------------------------

type GoogleTokenSuccessBody = {
  access_token: string;
  refresh_token?: string;
  scope: string;
  expires_in: number;
  token_type: string;
};

export type ExchangeWorkspaceCodeResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      grantedScopes: string[];
      expiresIn: number;
    }
  | { ok: false; error: string };

export async function exchangeWorkspaceCode(
  env: Env,
  code: string,
  codeVerifier: string,
): Promise<ExchangeWorkspaceCodeResult> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: workspaceRedirectUri(env),
    }),
  });
  if (!response.ok) return { ok: false, error: await safeErrorBody(response) };
  const body = await parseGoogleExchangeBody(response);
  if (!body) return { ok: false, error: "invalid_token_response" };
  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    grantedScopes: body.scope.split(/\s+/).filter(Boolean),
    expiresIn: body.expires_in,
  };
}

export type RefreshWorkspaceAccessTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: string };

export async function refreshWorkspaceAccessToken(
  env: Env,
  refreshToken: string,
): Promise<RefreshWorkspaceAccessTokenResult> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return { ok: false, error: await safeErrorBody(response) };
  const body = await parseGoogleAccessTokenBody(response);
  if (!body) return { ok: false, error: "invalid_token_response" };
  return { ok: true, accessToken: body.access_token, expiresIn: body.expires_in };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Google's token responses are an external boundary: validate before trusting any field. */
async function parseGoogleAccessTokenBody(
  response: Response,
): Promise<{ access_token: string; expires_in: number } | null> {
  const raw = await response.json().catch(() => null);
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (!isNonEmptyString(body.access_token) || !isPositiveFiniteNumber(body.expires_in)) {
    return null;
  }
  return { access_token: body.access_token, expires_in: body.expires_in };
}

async function parseGoogleExchangeBody(response: Response): Promise<GoogleTokenSuccessBody | null> {
  const raw = await response.json().catch(() => null);
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(body.access_token) ||
    !isNonEmptyString(body.scope) ||
    !isPositiveFiniteNumber(body.expires_in) ||
    (body.refresh_token !== undefined && !isNonEmptyString(body.refresh_token))
  ) {
    return null;
  }
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token as string | undefined,
    scope: body.scope,
    expires_in: body.expires_in,
    token_type: isNonEmptyString(body.token_type) ? body.token_type : "Bearer",
  };
}

/** Best-effort: disconnect should still remove the local row even if Google's revoke call fails. */
export async function revokeGoogleToken(env: Env, token: string): Promise<void> {
  await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.GOOGLE_CLIENT_ID}:${env.GOOGLE_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

async function safeErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
}

// --- Connection storage --------------------------------------------------

export type WorkspaceConnectionRow = {
  userId: string;
  refreshTokenCiphertext: string;
  refreshTokenNonce: string;
  encryptionKeyVersion: number;
  scope: string;
  connectedAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export async function getWorkspaceConnection(
  db: D1Database,
  userId: string,
): Promise<WorkspaceConnectionRow | null> {
  const row = await db
    .prepare(
      `SELECT userId, refreshTokenCiphertext, refreshTokenNonce, encryptionKeyVersion,
              scope, connectedAt, updatedAt, revokedAt
       FROM googleWorkspaceConnection WHERE userId = ?`,
    )
    .bind(userId)
    .first<WorkspaceConnectionRow>();
  return row ?? null;
}

/** Insert-or-reconnect. Reconnect clears any prior revocation and keeps the original connectedAt. */
export async function upsertWorkspaceConnection(
  env: Env,
  db: D1Database,
  userId: string,
  refreshToken: string,
  scope: string,
): Promise<void> {
  const { ciphertext, nonce, keyVersion } = await encryptRefreshToken(env, userId, refreshToken);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO googleWorkspaceConnection
         (userId, refreshTokenCiphertext, refreshTokenNonce, encryptionKeyVersion, scope, connectedAt, updatedAt, revokedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (userId) DO UPDATE SET
         refreshTokenCiphertext = excluded.refreshTokenCiphertext,
         refreshTokenNonce = excluded.refreshTokenNonce,
         encryptionKeyVersion = excluded.encryptionKeyVersion,
         scope = excluded.scope,
         updatedAt = excluded.updatedAt,
         revokedAt = NULL`,
    )
    .bind(userId, ciphertext, nonce, keyVersion, scope, now, now)
    .run();
}

export async function revokeWorkspaceConnection(db: D1Database, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE googleWorkspaceConnection SET revokedAt = ?, updatedAt = ? WHERE userId = ?")
    .bind(now, now, userId)
    .run();
}

/**
 * Rotation hook: call after any successful decrypt of a connection row. If
 * the row is still on an older encryption key version, re-encrypt it under
 * the current key and persist immediately — this is the "re-encrypt on next
 * refresh" half of the rotation procedure documented on
 * CURRENT_ENCRYPTION_KEY_VERSION above (the other half, a user-initiated
 * reconnect, already re-encrypts via upsertWorkspaceConnection). Without
 * this, a compromised key can only be retired once every connected user
 * happens to reconnect, which may never happen.
 */
export async function reencryptWorkspaceConnectionIfStale(
  env: Env,
  db: D1Database,
  userId: string,
  connection: WorkspaceConnectionRow,
  refreshToken: string,
): Promise<void> {
  if (connection.encryptionKeyVersion === CURRENT_ENCRYPTION_KEY_VERSION) return;
  await upsertWorkspaceConnection(env, db, userId, refreshToken, connection.scope);
}

// --- Token-vending rate limit + audit trail ------------------------------

export type TokenVendOutcome =
  | "ok"
  | "forbidden_caller"
  | "not_connected"
  | "rate_limited"
  | "google_error";

/**
 * Atomically reserves one request of quota for `callerUserId` in the current
 * fixed window and reports whether the caller is still under the limit. A
 * single `INSERT ... ON CONFLICT ... RETURNING` — rather than a separate
 * count-then-decide step — so concurrent requests can't all observe "under
 * the limit" and all proceed: D1/SQLite serializes writers, so each caller
 * gets a distinct, correctly-incremented count.
 */
export async function reserveTokenVendQuota(
  db: D1Database,
  callerUserId: string,
): Promise<boolean> {
  const windowMs = TOKEN_VEND_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO googleWorkspaceTokenRateLimit (callerUserId, windowStart, count)
       VALUES (?, ?, 1)
       ON CONFLICT (callerUserId) DO UPDATE SET
         count = CASE
           WHEN googleWorkspaceTokenRateLimit.windowStart = excluded.windowStart
           THEN googleWorkspaceTokenRateLimit.count + 1
           ELSE 1
         END,
         windowStart = excluded.windowStart
       RETURNING count`,
    )
    .bind(callerUserId, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? Number.POSITIVE_INFINITY) <= TOKEN_VEND_RATE_LIMIT_MAX;
}

export async function recordTokenVendAudit(
  db: D1Database,
  callerUserId: string,
  targetUserId: string,
  outcome: TokenVendOutcome,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO googleWorkspaceTokenAudit (id, callerUserId, targetUserId, outcome, createdAt) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), callerUserId, targetUserId, outcome, new Date().toISOString())
    .run();
}
