const DEFAULT_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ALLOWED_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CLOCK_SKEW_SECONDS = 60;
const MIN_JWKS_TTL_SECONDS = 60;
const DEFAULT_JWKS_TTL_SECONDS = 300;
const MAX_JWKS_TTL_SECONDS = 86_400;

export type PubsubJwtEnv = {
  PUBSUB_PUSH_AUDIENCE: string;
  PUBSUB_PUSH_SERVICE_ACCOUNT: string;
};

export type PubsubJwtDeps = {
  fetchFn?: typeof fetch;
  jwksUrl?: string;
  nowSec?: () => number;
};

export type PubsubJwtClaims = {
  iss: string;
  aud: string;
  email: string;
  email_verified: boolean;
  exp: number;
  nbf?: number;
  sub?: string;
};

export type VerifyPubsubJwtResult =
  | { ok: true; claims: PubsubJwtClaims }
  | { ok: false; status: 401 | 403; reason: string };

type GoogleRsaJwk = JsonWebKey & {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
};

type JwksCacheEntry = {
  jwksUrl: string;
  keys: GoogleRsaJwk[];
  expiresAtMs: number;
};

let jwksCache: JwksCacheEntry | null = null;

export function resetPubsubJwksCache(): void {
  jwksCache = null;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> | null {
  if (!segment || !BASE64URL_PATTERN.test(segment)) return null;
  const padded = segment
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(segment.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeJwtJson(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return DEFAULT_JWKS_TTL_SECONDS;
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheControl);
  if (!match) return DEFAULT_JWKS_TTL_SECONDS;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_JWKS_TTL_SECONDS;
  return Math.min(MAX_JWKS_TTL_SECONDS, Math.max(MIN_JWKS_TTL_SECONDS, parsed));
}

async function fetchJwksKeys(
  jwksUrl: string,
  fetchFn: typeof fetch,
  nowMs: number,
): Promise<GoogleRsaJwk[]> {
  const response = await fetchFn(jwksUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`JWKS 取得に失敗しました (HTTP ${response.status})`);
  }
  const raw = (await response.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { keys?: unknown }).keys)) {
    throw new Error("JWKS 応答の形式が不正です");
  }
  const keys = (raw as { keys: unknown[] }).keys.filter(
    (item): item is GoogleRsaJwk => Boolean(item) && typeof item === "object",
  );
  const ttlSec = parseMaxAgeSeconds(response.headers.get("cache-control"));
  jwksCache = {
    jwksUrl,
    keys,
    expiresAtMs: nowMs + ttlSec * 1000,
  };
  return keys;
}

async function findJwkByKid(
  kid: string,
  jwksUrl: string,
  fetchFn: typeof fetch,
  nowMs: number,
): Promise<GoogleRsaJwk | null> {
  const matchKey = (keys: GoogleRsaJwk[]) =>
    keys.find((k) => k.kid === kid && k.kty === "RSA") ?? null;

  const usedCache = Boolean(
    jwksCache && jwksCache.jwksUrl === jwksUrl && jwksCache.expiresAtMs > nowMs,
  );
  const initialKeys = usedCache
    ? (jwksCache?.keys ?? [])
    : await fetchJwksKeys(jwksUrl, fetchFn, nowMs);
  const initialHit = matchKey(initialKeys);
  if (initialHit) return initialHit;

  if (usedCache) {
    const refreshedKeys = await fetchJwksKeys(jwksUrl, fetchFn, nowMs);
    return matchKey(refreshedKeys);
  }
  return null;
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

export async function verifyPubsubJwt(
  request: Request,
  env: PubsubJwtEnv,
  deps: PubsubJwtDeps = {},
): Promise<VerifyPubsubJwtResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, reason: "Authorization Bearer トークンが必要です" };
  }

  const expectedAudience = env.PUBSUB_PUSH_AUDIENCE.trim();
  const expectedServiceAccount = env.PUBSUB_PUSH_SERVICE_ACCOUNT.trim();
  if (!expectedAudience || !expectedServiceAccount) {
    return { ok: false, status: 403, reason: "Pub/Sub Push 検証設定が未構成です" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 403, reason: "JWT の形式が不正です" };
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeJwtJson(headerB64);
  const payload = decodeJwtJson(payloadB64);
  const signatureBytes = base64UrlToBytes(signatureB64);
  if (!header || !payload || !signatureBytes) {
    return { ok: false, status: 403, reason: "JWT のデコードに失敗しました" };
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string" || header.kid.length === 0) {
    return { ok: false, status: 403, reason: "JWT ヘッダー（alg/kid）が不正です" };
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const jwksUrl = deps.jwksUrl ?? DEFAULT_GOOGLE_JWKS_URL;
  const nowSec = (deps.nowSec ?? (() => Math.floor(Date.now() / 1000)))();

  let jwk: GoogleRsaJwk | null;
  try {
    jwk = await findJwkByKid(header.kid, jwksUrl, fetchFn, nowSec * 1000);
  } catch {
    return { ok: false, status: 403, reason: "JWKS の取得に失敗しました" };
  }
  if (!jwk) {
    return { ok: false, status: 403, reason: "一致する署名鍵が見つかりません" };
  }

  let signatureValid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signatureBytes,
      signingInput,
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return { ok: false, status: 403, reason: "JWT 署名の検証に失敗しました" };
  }

  const iss = typeof payload.iss === "string" ? payload.iss : "";
  const aud = typeof payload.aud === "string" ? payload.aud : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  const emailVerified = payload.email_verified === true;
  const exp = typeof payload.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  const nbf = payload.nbf;

  if (!ALLOWED_ISSUERS.has(iss)) {
    return { ok: false, status: 403, reason: "JWT iss が一致しません" };
  }
  if (aud !== expectedAudience) {
    return { ok: false, status: 403, reason: "JWT aud が一致しません" };
  }
  if (email !== expectedServiceAccount) {
    return { ok: false, status: 403, reason: "JWT email が一致しません" };
  }
  if (!emailVerified) {
    return { ok: false, status: 403, reason: "JWT email_verified が true ではありません" };
  }
  if (exp === null || exp <= nowSec - CLOCK_SKEW_SECONDS) {
    return { ok: false, status: 403, reason: "JWT の有効期限が切れています" };
  }
  if (nbf !== undefined) {
    if (typeof nbf !== "number" || !Number.isFinite(nbf) || nbf > nowSec + CLOCK_SKEW_SECONDS) {
      return { ok: false, status: 403, reason: "JWT の有効開始時刻前です" };
    }
  }

  return {
    ok: true,
    claims: {
      iss,
      aud,
      email,
      email_verified: true,
      exp,
      ...(typeof nbf === "number" ? { nbf } : {}),
      ...(typeof payload.sub === "string" ? { sub: payload.sub } : {}),
    },
  };
}
