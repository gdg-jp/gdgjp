import { X509Certificate, createPublicKey, verify as verifySignature } from "node:crypto";

/** ±5 minute acceptance window for platform timestamps. */
export const TIMESTAMP_WINDOW_SECONDS = 5 * 60;

/** Replay TTL must outlast the timestamp window. */
export const REPLAY_TTL_SECONDS = TIMESTAMP_WINDOW_SECONDS + 60;

export const GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com";

export const GOOGLE_CHAT_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";

const CERT_CACHE_TTL_MS = 60 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type ReplayStore = {
  /** Returns true if `id` was already recorded (duplicate). */
  seen(id: string): Promise<boolean>;
  /** Record `id` with TTL. Idempotent for the same id. */
  remember(id: string, ttlSeconds: number): Promise<void>;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type VerifyEnv = {
  GOOGLE_CHAT_AUDIENCE: string;
  DISCORD_PUBLIC_KEY: string;
};

export type VerifyDeps = {
  env: VerifyEnv;
  replay: ReplayStore;
  fetch?: FetchLike;
  nowSeconds?: () => number;
  /** Test hook: seed/replace the cert cache without a network call. */
  certCache?: CertCache;
};

export type VerifyOk =
  | {
      ok: true;
      platform: "google-chat";
      messageId: string;
    }
  | {
      ok: true;
      platform: "discord";
      messageId: string;
      discordPing?: false;
    }
  | {
      ok: true;
      platform: "discord";
      /** Discord interaction type 1 (PING) has no application-level side effects. */
      discordPing: true;
      messageId?: string;
    };

export type VerifyFail = {
  ok: false;
  status: 401;
  reason:
    | "missing_authorization"
    | "unsigned"
    | "alg_none"
    | "bad_signature"
    | "bad_issuer"
    | "bad_audience"
    | "expired"
    | "timestamp_out_of_window"
    | "replay"
    | "missing_discord_headers"
    | "invalid_body"
    | "misconfigured";
};

export type VerifyResult = VerifyOk | VerifyFail;

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type JwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  jti?: string;
};

export type CertCache = {
  byKid: Map<string, string>;
  expiresAt: number;
};

let defaultCertCache: CertCache | null = null;

function fail(reason: VerifyFail["reason"]): VerifyFail {
  return { ok: false, status: 401, reason };
}

function base64UrlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

function decodeJsonPart<T>(part: string): T | null {
  try {
    return JSON.parse(base64UrlToBuffer(part).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (aud === undefined) return false;
  if (typeof aud === "string") return aud === expected;
  return aud.includes(expected);
}

function withinWindow(timestampSeconds: number, nowSeconds: number): boolean {
  return Math.abs(nowSeconds - timestampSeconds) <= TIMESTAMP_WINDOW_SECONDS;
}

async function loadGoogleChatCerts(
  fetchImpl: FetchLike,
  cache: CertCache | null | undefined,
  forceRefresh: boolean,
): Promise<CertCache> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now && cache.byKid.size > 0) {
    return cache;
  }
  if (!forceRefresh && defaultCertCache && defaultCertCache.expiresAt > now) {
    return defaultCertCache;
  }

  const response = await fetchImpl(GOOGLE_CHAT_CERTS_URL);
  if (!response.ok) {
    throw new Error(`cert_fetch_failed:${response.status}`);
  }
  const body = (await response.json()) as Record<string, string>;
  const byKid = new Map<string, string>();
  for (const [kid, pem] of Object.entries(body)) {
    if (typeof pem === "string") byKid.set(kid, pem);
  }
  const next: CertCache = { byKid, expiresAt: now + CERT_CACHE_TTL_MS };
  defaultCertCache = next;
  return next;
}

/** Test-only: clear the process-wide cert cache. */
export function clearGoogleChatCertCacheForTests(): void {
  defaultCertCache = null;
}

function publicKeyFromPemCertificate(pem: string) {
  const cert = new X509Certificate(pem);
  return createPublicKey(cert.publicKey);
}

function publicKeyFromPem(pem: string) {
  if (pem.includes("BEGIN CERTIFICATE")) {
    return publicKeyFromPemCertificate(pem);
  }
  return createPublicKey(pem);
}

async function verifyGoogleChatJwt(token: string, deps: VerifyDeps): Promise<VerifyResult> {
  const audience = deps.env.GOOGLE_CHAT_AUDIENCE.trim();
  if (!audience) return fail("misconfigured");

  const parts = token.split(".");
  if (parts.length < 2) return fail("unsigned");
  const [headerPart, payloadPart, signaturePart = ""] = parts;
  if (!headerPart || !payloadPart) return fail("unsigned");

  const header = decodeJsonPart<JwtHeader>(headerPart);
  if (!header) return fail("unsigned");
  if (!header.alg || header.alg.toLowerCase() === "none") return fail("alg_none");
  if (parts.length !== 3 || !signaturePart) return fail("unsigned");
  if (header.alg !== "RS256") return fail("bad_signature");
  if (!header.kid) return fail("bad_signature");

  const payload = decodeJsonPart<JwtPayload>(payloadPart);
  if (!payload) return fail("invalid_body");

  // Reject a wrong issuer before any network I/O.
  if (payload.iss !== undefined && payload.iss !== GOOGLE_CHAT_ISSUER) {
    return fail("bad_issuer");
  }

  const fetchImpl = deps.fetch ?? fetch;
  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();

  let cache = await loadGoogleChatCerts(fetchImpl, deps.certCache, false);
  let pem = cache.byKid.get(header.kid);
  if (!pem) {
    cache = await loadGoogleChatCerts(fetchImpl, deps.certCache, true);
    pem = cache.byKid.get(header.kid);
  }
  if (!pem) return fail("bad_signature");

  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToBuffer(signaturePart);
  const key = publicKeyFromPem(pem);
  const valid = verifySignature("RSA-SHA256", signingInput, key, signature);
  if (!valid) return fail("bad_signature");

  if (payload.iss !== GOOGLE_CHAT_ISSUER) return fail("bad_issuer");
  if (!audienceMatches(payload.aud, audience)) return fail("bad_audience");
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return fail("expired");
  if (typeof payload.iat !== "number" || !withinWindow(payload.iat, nowSeconds)) {
    return fail("timestamp_out_of_window");
  }
  if (typeof payload.jti !== "string" || payload.jti.length === 0) {
    return fail("invalid_body");
  }

  const replayKey = `gchat:jti:${payload.jti}`;
  if (await deps.replay.seen(replayKey)) return fail("replay");
  await deps.replay.remember(replayKey, REPLAY_TTL_SECONDS);

  return {
    ok: true,
    platform: "google-chat",
    messageId: payload.jti,
  };
}

function discordPublicKey(hex: string) {
  const raw = Buffer.from(hex.trim().toLowerCase(), "hex");
  if (raw.length !== 32) {
    throw new Error("invalid_discord_public_key");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function verifyDiscordEd25519(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): boolean {
  try {
    const key = discordPublicKey(publicKeyHex);
    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) return false;
    return verifySignature(null, Buffer.from(`${timestamp}${rawBody}`), key, signature);
  } catch {
    return false;
  }
}

async function verifyDiscordInteraction(
  rawBody: string,
  headers: Headers,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const publicKey = deps.env.DISCORD_PUBLIC_KEY.trim();
  if (!publicKey) return fail("misconfigured");

  const signature = headers.get("x-signature-ed25519");
  const timestamp = headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return fail("missing_discord_headers");

  const nowSeconds = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || !withinWindow(timestampSeconds, nowSeconds)) {
    return fail("timestamp_out_of_window");
  }

  if (!verifyDiscordEd25519(publicKey, signature, timestamp, rawBody)) {
    return fail("bad_signature");
  }

  let body: { id?: unknown; type?: unknown };
  try {
    body = JSON.parse(rawBody) as { id?: unknown; type?: unknown };
  } catch {
    return fail("invalid_body");
  }

  // Discord's endpoint validation payload is only guaranteed to contain
  // `type: 1`. A signed PING must be answered before replay storage or adapter
  // initialization so endpoint registration does not depend on Redis.
  if (body.type === 1) {
    return {
      ok: true,
      platform: "discord",
      discordPing: true,
      ...(typeof body.id === "string" && body.id.length > 0 ? { messageId: body.id } : {}),
    };
  }

  if (typeof body.id !== "string" || body.id.length === 0) {
    return fail("invalid_body");
  }

  const replayKey = `discord:id:${body.id}`;
  if (await deps.replay.seen(replayKey)) return fail("replay");
  await deps.replay.remember(replayKey, REPLAY_TTL_SECONDS);

  return {
    ok: true,
    platform: "discord",
    messageId: body.id,
  };
}

function looksLikeDiscord(headers: Headers): boolean {
  return headers.has("x-signature-ed25519") || headers.has("x-signature-timestamp");
}

/**
 * Verify an inbound Google Chat or Discord webhook before any application logic.
 *
 * Callers must pass the raw body from a single `request.text()` read — never
 * re-serialize JSON for Discord Ed25519 verification.
 */
export async function verifyWebhook(
  request: Request,
  rawBody: string,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  if (looksLikeDiscord(request.headers)) {
    return verifyDiscordInteraction(rawBody, request.headers, deps);
  }

  const authorization = request.headers.get("authorization");
  if (!authorization) return fail("missing_authorization");
  const match = /^Bearer\s+(\S+)/i.exec(authorization);
  if (!match) return fail("missing_authorization");
  const token = match[1] ?? "";
  if (!token) return fail("unsigned");
  return verifyGoogleChatJwt(token, deps);
}

/** In-memory ReplayStore for tests. */
export function createMemoryReplayStore(): ReplayStore & {
  reads: number;
  remembers: number;
  keys: Set<string>;
} {
  const keys = new Set<string>();
  return {
    keys,
    reads: 0,
    remembers: 0,
    async seen(id: string) {
      this.reads += 1;
      return keys.has(id);
    },
    async remember(id: string) {
      this.remembers += 1;
      keys.add(id);
    },
  };
}

/** Redis ReplayStore using SET NX + EX for atomic insert. */
export function createRedisReplayStore(redis: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", ttl: number, setMode: "NX"): Promise<unknown>;
}): ReplayStore {
  return {
    async seen(id: string) {
      return (await redis.get(id)) !== null;
    },
    async remember(id: string, ttlSeconds: number) {
      await redis.set(id, "1", "EX", ttlSeconds, "NX");
    },
  };
}
