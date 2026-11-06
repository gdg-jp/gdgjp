import { buffer, base64UrlDecode, hexToBytes, nowSeconds } from "../../lib";

/** ±5 minute acceptance window for platform timestamps (v1 contract). */
export const TIMESTAMP_WINDOW_SECONDS = 5 * 60;
export const REPLAY_TTL_SECONDS = TIMESTAMP_WINDOW_SECONDS + 60;
export const GOOGLE_CHAT_ISSUER = "chat@system.gserviceaccount.com";
export const GOOGLE_CHAT_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com";

export type ReplayStore = {
  /** Records `id`; returns false if it was already recorded (a replay). */
  claim(id: string, ttlSeconds: number): Promise<boolean>;
};

export type VerifyDeps = {
  discordPublicKey: string;
  googleChatAudience?: string;
  replay: ReplayStore;
  fetch?: typeof fetch;
  now?: () => number;
};

export type VerifyResult =
  | { ok: true; platform: "discord"; ping: boolean; messageId: string }
  | { ok: true; platform: "google-chat"; messageId: string }
  | { ok: false; reason: string };

const fail = (reason: string): VerifyResult => ({ ok: false, reason });

export function withinWindow(timestamp: number, now: number): boolean {
  return Math.abs(now - timestamp) <= TIMESTAMP_WINDOW_SECONDS;
}

export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      buffer(hexToBytes(publicKeyHex)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signature = hexToBytes(signatureHex);
    if (signature.length !== 64) return false;
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      buffer(signature),
      new TextEncoder().encode(timestamp + rawBody),
    );
  } catch {
    return false;
  }
}

async function verifyDiscord(
  request: Request,
  rawBody: string,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  if (!deps.discordPublicKey.trim()) return fail("misconfigured");
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return fail("missing_discord_headers");
  const now = (deps.now ?? nowSeconds)();
  if (!withinWindow(Number(timestamp), now)) return fail("timestamp_out_of_window");
  if (!(await verifyDiscordSignature(deps.discordPublicKey, signature, timestamp, rawBody))) {
    return fail("bad_signature");
  }
  let body: { id?: unknown; type?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail("invalid_body");
  }
  // A signed PING is answered before replay storage so endpoint registration needs no state.
  if (body.type === 1)
    return { ok: true, platform: "discord", ping: true, messageId: String(body.id ?? "") };
  if (typeof body.id !== "string" || !body.id) return fail("invalid_body");
  if (!(await deps.replay.claim(`discord:id:${body.id}`, REPLAY_TTL_SECONDS)))
    return fail("replay");
  return { ok: true, platform: "discord", ping: false, messageId: body.id };
}

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

async function googleChatKey(
  kid: string,
  fetchImpl: typeof fetch,
  refresh: boolean,
): Promise<Jwk | undefined> {
  if (refresh || !jwksCache || jwksCache.expiresAt < Date.now()) {
    const response = await fetchImpl(GOOGLE_CHAT_JWKS_URL);
    if (!response.ok) throw new Error(`jwks_fetch_failed:${response.status}`);
    const body = (await response.json()) as { keys?: Jwk[] };
    jwksCache = { keys: body.keys ?? [], expiresAt: Date.now() + 60 * 60 * 1000 };
  }
  return jwksCache.keys.find((key) => key.kid === kid);
}

export function clearJwksCacheForTests(): void {
  jwksCache = null;
}

async function verifyGoogleChat(request: Request, deps: VerifyDeps): Promise<VerifyResult> {
  const audience = deps.googleChatAudience?.trim();
  if (!audience) return fail("misconfigured");
  const match = /^Bearer\s+(\S+)/i.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) return fail("missing_authorization");
  const parts = match[1].split(".");
  if (parts.length !== 3 || !parts[2]) return fail("unsigned");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let payload: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; jti?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return fail("invalid_body");
  }
  if (!header.alg || header.alg.toLowerCase() === "none") return fail("alg_none");
  if (header.alg !== "RS256" || !header.kid) return fail("bad_signature");
  if (payload.iss !== GOOGLE_CHAT_ISSUER) return fail("bad_issuer");
  const fetchImpl = deps.fetch ?? fetch;
  const jwk =
    (await googleChatKey(header.kid, fetchImpl, false)) ??
    (await googleChatKey(header.kid, fetchImpl, true));
  if (!jwk) return fail("bad_signature");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    buffer(base64UrlDecode(signaturePart)),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return fail("bad_signature");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return fail("bad_audience");
  const now = (deps.now ?? nowSeconds)();
  if (typeof payload.exp !== "number" || payload.exp < now) return fail("expired");
  if (typeof payload.iat !== "number" || !withinWindow(payload.iat, now))
    return fail("timestamp_out_of_window");
  if (typeof payload.jti !== "string" || !payload.jti) return fail("invalid_body");
  if (!(await deps.replay.claim(`gchat:jti:${payload.jti}`, REPLAY_TTL_SECONDS)))
    return fail("replay");
  return { ok: true, platform: "google-chat", messageId: payload.jti };
}

/** Verify an inbound Discord interaction or Google Chat event before any application logic. */
export async function verifyWebhook(
  request: Request,
  rawBody: string,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  if (request.headers.has("x-signature-ed25519") || request.headers.has("x-signature-timestamp")) {
    return verifyDiscord(request, rawBody, deps);
  }
  return verifyGoogleChat(request, deps);
}

/** KV replay store. KV is eventually consistent, so this is best-effort dedupe on top of
 * the timestamp window; Discord retries reuse the interaction id within seconds. */
export function kvReplayStore(kv: KVNamespace): ReplayStore {
  return {
    async claim(id, ttlSeconds) {
      const key = `replay:${id}`;
      if (await kv.get(key)) return false;
      await kv.put(key, "1", { expirationTtl: Math.max(60, ttlSeconds) });
      return true;
    },
  };
}

export function memoryReplayStore(): ReplayStore & { keys: Set<string> } {
  const keys = new Set<string>();
  return {
    keys,
    async claim(id) {
      if (keys.has(id)) return false;
      keys.add(id);
      return true;
    },
  };
}
