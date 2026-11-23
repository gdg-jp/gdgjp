import { upsertGoogleConnection } from "~/features/google/connection.server";
import { normalizeEmail } from "~/features/google/email";
import {
  type GoogleEncryptionEnv,
  base64UrlToBytes,
  randomToken,
  sha256Base64Url,
} from "~/features/google/encryption.server";

export {
  GOOGLE_CONNECTION_ID,
  type GoogleConnectionRow,
  type GoogleConnectionStatus,
  type GoogleConnectionSummary,
  getGoogleConnection,
  getGoogleConnectionSummary,
  markGoogleConnectionDisconnected,
  reencryptGoogleConnectionIfStale,
  upsertGoogleConnection,
} from "~/features/google/connection.server";

export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 600;
export const GOOGLE_HOST_DOMAIN = "gdgoc.jp";

export const GOOGLE_REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.settings",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive",
] as const;

export const GOOGLE_OAUTH_SCOPES = [...GOOGLE_REQUIRED_SCOPES, "openid", "email"] as const;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleOAuthEnv = GoogleEncryptionEnv & {
  DB: D1Database;
  APP_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_HOST_EMAIL: string;
};

export type GoogleOAuthCallbackErrorCode =
  | "missing_state"
  | "state_invalid"
  | "access_denied"
  | "google_error"
  | "missing_code"
  | "exchange_failed"
  | "scope_missing"
  | "missing_refresh_token"
  | "email_unverified"
  | "wrong_account"
  | "invalid_identity"
  | "userinfo_failed";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function googleRedirectUri(env: Pick<GoogleOAuthEnv, "APP_URL">): string {
  return `${trimTrailingSlash(env.APP_URL)}/admin/google/callback`;
}

export function buildGoogleAuthorizeUrl(
  env: Pick<GoogleOAuthEnv, "APP_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_HOST_EMAIL">,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(env),
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    hd: GOOGLE_HOST_DOMAIN,
    login_hint: env.GOOGLE_HOST_EMAIL,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function sweepExpiredGoogleOauthState(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare("DELETE FROM google_oauth_state WHERE expires_at <= ?")
    .bind(now.toISOString())
    .run();
}

export async function createGoogleOauthState(
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<{ state: string; codeChallenge: string }> {
  await sweepExpiredGoogleOauthState(db, now);
  const state = randomToken(32);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const expiresAt = new Date(now.getTime() + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1000);
  await db
    .prepare(
      `INSERT INTO google_oauth_state (id, user_id, code_verifier, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(state, userId, codeVerifier, now.toISOString(), expiresAt.toISOString())
    .run();
  return { state, codeChallenge };
}

type GoogleOauthStateRow = {
  user_id: string;
  code_verifier: string;
  expires_at: string;
};

export type ConsumedGoogleOauthState =
  | { ok: true; userId: string; codeVerifier: string }
  | { ok: false; reason: "not_found" | "expired" | "session_mismatch" };

export async function consumeGoogleOauthState(
  db: D1Database,
  state: string,
  sessionUserId: string,
  now = new Date(),
): Promise<ConsumedGoogleOauthState> {
  const row = await db
    .prepare(
      "DELETE FROM google_oauth_state WHERE id = ? RETURNING user_id, code_verifier, expires_at",
    )
    .bind(state)
    .first<GoogleOauthStateRow>();
  if (!row) return { ok: false, reason: "not_found" };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.user_id !== sessionUserId) return { ok: false, reason: "session_mismatch" };
  return { ok: true, userId: row.user_id, codeVerifier: row.code_verifier };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export type ExchangeGoogleAuthCodeResult =
  | {
      ok: true;
      accessToken: string;
      refreshToken: string | null;
      idToken: string | null;
      grantedScopes: string[];
      expiresIn: number;
    }
  | { ok: false; error: string };

export async function exchangeGoogleAuthCode(
  env: Pick<GoogleOAuthEnv, "APP_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET">,
  code: string,
  codeVerifier: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<ExchangeGoogleAuthCodeResult> {
  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: googleRedirectUri(env),
    }),
  });
  if (!response.ok) {
    const raw = await response.json().catch(() => null);
    const codeText =
      raw && typeof raw === "object" && isNonEmptyString((raw as Record<string, unknown>).error)
        ? String((raw as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    return { ok: false, error: codeText };
  }
  const raw = await response.json().catch(() => null);
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_token_response" };
  const body = raw as Record<string, unknown>;
  if (
    !isNonEmptyString(body.access_token) ||
    !isNonEmptyString(body.scope) ||
    !isPositiveFiniteNumber(body.expires_in) ||
    (body.refresh_token !== undefined && !isNonEmptyString(body.refresh_token)) ||
    (body.id_token !== undefined && !isNonEmptyString(body.id_token))
  ) {
    return { ok: false, error: "invalid_token_response" };
  }
  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: (body.refresh_token as string | undefined) ?? null,
    idToken: (body.id_token as string | undefined) ?? null,
    grantedScopes: body.scope.split(/\s+/).filter(Boolean),
    expiresIn: body.expires_in,
  };
}

type IdentityClaims = {
  sub?: string;
  email?: string;
  emailVerified?: boolean;
  aud?: string;
};

function decodeIdTokenPayload(idToken: string): IdentityClaims | null {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(parts[1]));
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    return {
      sub: isNonEmptyString(obj.sub) ? obj.sub : undefined,
      email: isNonEmptyString(obj.email) ? obj.email : undefined,
      emailVerified: typeof obj.email_verified === "boolean" ? obj.email_verified : undefined,
      aud: isNonEmptyString(obj.aud) ? obj.aud : undefined,
    };
  } catch {
    return null;
  }
}

async function fetchGoogleUserInfo(
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<IdentityClaims | null> {
  const response = await fetchFn(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) return null;
  const raw = await response.json().catch(() => null);
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    sub: isNonEmptyString(obj.sub) ? obj.sub : undefined,
    email: isNonEmptyString(obj.email) ? obj.email : undefined,
    emailVerified: typeof obj.email_verified === "boolean" ? obj.email_verified : undefined,
  };
}

async function resolveVerifiedHostIdentity(
  env: Pick<GoogleOAuthEnv, "GOOGLE_CLIENT_ID" | "GOOGLE_HOST_EMAIL">,
  accessToken: string,
  idToken: string | null,
  fetchFn: typeof fetch,
): Promise<
  | { ok: true; email: string; googleUserId: string }
  | { ok: false; errorCode: GoogleOAuthCallbackErrorCode }
> {
  let idClaims: IdentityClaims | null = null;
  if (idToken) {
    idClaims = decodeIdTokenPayload(idToken);
    if (!idClaims) return { ok: false, errorCode: "invalid_identity" };
    if (idClaims.aud && idClaims.aud !== env.GOOGLE_CLIENT_ID) {
      return { ok: false, errorCode: "invalid_identity" };
    }
  }

  let claims = idClaims;
  if (!claims || !claims.sub || !claims.email || claims.emailVerified === undefined) {
    const userInfo = await fetchGoogleUserInfo(accessToken, fetchFn);
    if (!userInfo) return { ok: false, errorCode: "userinfo_failed" };
    if (idClaims?.sub && userInfo.sub && idClaims.sub !== userInfo.sub) {
      return { ok: false, errorCode: "invalid_identity" };
    }
    claims = {
      sub: userInfo.sub ?? idClaims?.sub,
      email: userInfo.email ?? idClaims?.email,
      emailVerified: userInfo.emailVerified ?? idClaims?.emailVerified,
    };
  }

  if (!claims.sub || !claims.email) return { ok: false, errorCode: "invalid_identity" };
  if (claims.emailVerified !== true) return { ok: false, errorCode: "email_unverified" };
  if (normalizeEmail(claims.email) !== normalizeEmail(env.GOOGLE_HOST_EMAIL)) {
    return { ok: false, errorCode: "wrong_account" };
  }
  return { ok: true, email: claims.email, googleUserId: claims.sub };
}

export type CompleteGoogleOauthCallbackResult =
  | { ok: true; email: string; googleUserId: string }
  | { ok: false; errorCode: GoogleOAuthCallbackErrorCode };

export async function completeGoogleOauthCallback(
  env: GoogleOAuthEnv,
  sessionUserId: string,
  params: { state: string | null; code: string | null; googleError: string | null },
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<CompleteGoogleOauthCallbackResult> {
  if (!params.state) return { ok: false, errorCode: "missing_state" };

  const consumed = await consumeGoogleOauthState(env.DB, params.state, sessionUserId);
  if (!consumed.ok) return { ok: false, errorCode: "state_invalid" };

  if (params.googleError) {
    return {
      ok: false,
      errorCode: params.googleError === "access_denied" ? "access_denied" : "google_error",
    };
  }
  if (!params.code) return { ok: false, errorCode: "missing_code" };

  const exchange = await exchangeGoogleAuthCode(env, params.code, consumed.codeVerifier, fetchFn);
  if (!exchange.ok) return { ok: false, errorCode: "exchange_failed" };

  const hasAllRequiredScopes = GOOGLE_REQUIRED_SCOPES.every((required) =>
    exchange.grantedScopes.includes(required),
  );
  if (!hasAllRequiredScopes) return { ok: false, errorCode: "scope_missing" };
  if (!exchange.refreshToken) return { ok: false, errorCode: "missing_refresh_token" };

  const identity = await resolveVerifiedHostIdentity(
    env,
    exchange.accessToken,
    exchange.idToken,
    fetchFn,
  );
  if (!identity.ok) return identity;

  await upsertGoogleConnection(env, env.DB, {
    email: identity.email,
    googleUserId: identity.googleUserId,
    refreshToken: exchange.refreshToken,
    scope: exchange.grantedScopes.join(" "),
    connectedByUserId: sessionUserId,
  });

  return { ok: true, email: identity.email, googleUserId: identity.googleUserId };
}
