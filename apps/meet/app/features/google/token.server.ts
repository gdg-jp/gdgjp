import {
  getGoogleConnection,
  markGoogleConnectionDisconnected,
  reencryptGoogleConnectionIfStale,
} from "~/features/google/connection.server";
import {
  GOOGLE_CONNECTION_AAD,
  type GoogleEncryptionEnv,
  decryptRefreshToken,
} from "~/features/google/encryption.server";
import { GOOGLE_TOKEN_URL } from "~/features/google/oauth.server";

export type GoogleTokenEnv = GoogleEncryptionEnv & {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

export type GoogleConnectionErrorCode = "not_connected" | "invalid_grant" | "refresh_failed";

export class GoogleConnectionError extends Error {
  readonly code: GoogleConnectionErrorCode;

  constructor(code: GoogleConnectionErrorCode, message: string) {
    super(message);
    this.name = "GoogleConnectionError";
    this.code = code;
  }
}

const EXPIRY_BUFFER_MS = 60_000;

type CachedToken = {
  db: D1Database;
  accessToken: string;
  expiresAtMs: number;
};

type InFlightRefresh = {
  db: D1Database;
  promise: Promise<string>;
};

let cachedToken: CachedToken | null = null;
let inFlightRefresh: InFlightRefresh | null = null;

export function resetGoogleAccessTokenCache(): void {
  cachedToken = null;
  inFlightRefresh = null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatSafeErrorSummary(status: number, errorCode?: string, description?: string): string {
  const parts = [errorCode ?? `HTTP ${status}`];
  if (description) parts.push(description);
  return parts.join(": ").slice(0, 200);
}

function isInvalidTokenResponse(status: number, errorCode?: string): boolean {
  if (errorCode === "invalid_grant" || errorCode === "invalid_token") return true;
  if ((status === 400 || status === 401) && errorCode === "unauthorized_client") return true;
  if (status === 401 && !errorCode) return true;
  return false;
}

async function refreshAccessToken(env: GoogleTokenEnv, fetchFn: typeof fetch): Promise<string> {
  const connection = await getGoogleConnection(env.DB);
  if (!connection || connection.status !== "connected") {
    throw new GoogleConnectionError("not_connected", "共有 Google アカウントが接続されていません");
  }

  const refreshToken = await decryptRefreshToken(
    env,
    GOOGLE_CONNECTION_AAD,
    connection.encryption_key_version,
    connection.refresh_token_ciphertext,
    connection.refresh_token_nonce,
  );

  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const raw = await response.json().catch(() => null);
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const errorCode = obj && isNonEmptyString(obj.error) ? obj.error : undefined;
    const errorDescription =
      obj && isNonEmptyString(obj.error_description) ? obj.error_description : undefined;

    if (isInvalidTokenResponse(response.status, errorCode)) {
      const summary = formatSafeErrorSummary(response.status, errorCode, errorDescription);
      await markGoogleConnectionDisconnected(env.DB, summary);
      cachedToken = null;
      throw new GoogleConnectionError(
        "invalid_grant",
        "共有 Google アカウントの認可が失効しました。管理画面から再接続してください。",
      );
    }

    throw new GoogleConnectionError(
      "refresh_failed",
      `Google アクセストークンの更新に失敗しました (${formatSafeErrorSummary(response.status, errorCode)})`,
    );
  }

  const raw = await response.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || !isNonEmptyString(body.access_token) || !isPositiveFiniteNumber(body.expires_in)) {
    throw new GoogleConnectionError(
      "refresh_failed",
      "Google トークンエンドポイントから不正な応答を受け取りました",
    );
  }

  await reencryptGoogleConnectionIfStale(env, env.DB, connection, refreshToken);

  cachedToken = {
    db: env.DB,
    accessToken: body.access_token,
    expiresAtMs: Date.now() + body.expires_in * 1000,
  };
  return body.access_token;
}

export async function getGoogleAccessToken(
  env: GoogleTokenEnv,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (
    cachedToken &&
    cachedToken.db === env.DB &&
    cachedToken.expiresAtMs - Date.now() > EXPIRY_BUFFER_MS
  ) {
    return cachedToken.accessToken;
  }

  if (inFlightRefresh && inFlightRefresh.db === env.DB) {
    return inFlightRefresh.promise;
  }

  const promise = refreshAccessToken(env, fetchFn).finally(() => {
    if (inFlightRefresh?.promise === promise) {
      inFlightRefresh = null;
    }
  });
  inFlightRefresh = { db: env.DB, promise };
  return promise;
}
