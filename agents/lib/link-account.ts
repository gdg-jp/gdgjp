import { CHAPTERS_SCOPE } from "@gdgjp/gdg-lib/auth/claims";

import {
  type ChatPlatform,
  type LinkRedis,
  createLinkRedis,
  getRedis,
  linkGuildKey,
  linkStateKey,
  linkUserKey,
} from "./redis";
import {
  type EncryptedPayload,
  type TokenKeyring,
  decryptToken,
  encryptToken,
  parseTokenEncryptionKeys,
} from "./token-crypto";

export type { ChatPlatform };
export type { LinkRedis };

/** Must match the seeded agents client redirect URI byte for byte. */
export const REDIRECT_URI = "https://agent.gdgs.jp/auth/callback";

export const STATE_TTL_SECONDS = 10 * 60;
export const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;
export const REFRESH_LEASE_SECONDS = 30;

export const OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  CHAPTERS_SCOPE,
] as const;

export type LinkAccountEnv = {
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  ACCOUNTS_URL: string;
  TOKEN_ENCRYPTION_KEYS: string;
};

export type LinkStateRecord = {
  platform: ChatPlatform;
  chatUserId: string;
  codeVerifier: string;
  spaceId: string;
  createdAt: number;
};

export type StoredLinkRecord = {
  platform: ChatPlatform;
  chatUserId: string;
  accessToken: EncryptedPayload;
  /** Unix seconds. */
  accessTokenExpiresAt: number;
  refreshToken: EncryptedPayload;
  refreshLease?: {
    owner: string;
    expiresAt: number;
  };
  subject: string | null;
  linkedAt: number;
};

export type LinkedTokenOk = {
  status: "ok";
  accessToken: string;
};

export type LinkedTokenNeedsLink = {
  status: "needs_link";
  authorizationUrl: string;
};

export type LinkedTokenTemporarilyUnavailable = {
  status: "temporarily_unavailable";
};

export type LinkedTokenResult =
  | LinkedTokenOk
  | LinkedTokenNeedsLink
  | LinkedTokenTemporarilyUnavailable;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type LinkAccountDeps = {
  env: LinkAccountEnv;
  redis: LinkRedis;
  fetch?: FetchLike;
  nowSeconds?: () => number;
  /** Override keyring parse (tests). */
  keyring?: TokenKeyring;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type UserInfoResponse = {
  sub?: string;
};

type ReadLinkRecord = {
  record: StoredLinkRecord;
  serialized: string;
};

class InvalidGrantError extends Error {}

const LINK_RECORD_TTL_SECONDS = 2592000 + 86400;

function nowFn(deps: LinkAccountDeps): number {
  return (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
}

function accountsBase(env: LinkAccountEnv): string {
  return env.ACCOUNTS_URL.replace(/\/$/, "");
}

export function authorizeUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/authorize`;
}

export function tokenUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/token`;
}

export function userInfoUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/userinfo`;
}

export function revokeUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/revoke`;
}

function basicAuthHeader(env: LinkAccountEnv): string {
  const credentials = Buffer.from(`${env.IDP_CLIENT_ID}:${env.IDP_CLIENT_SECRET}`, "utf8").toString(
    "base64",
  );
  return `Basic ${credentials}`;
}

function requireEnv(env: LinkAccountEnv): void {
  if (!env.IDP_CLIENT_ID?.trim()) throw new Error("IDP_CLIENT_ID is not configured");
  if (!env.IDP_CLIENT_SECRET?.trim()) throw new Error("IDP_CLIENT_SECRET is not configured");
  if (!env.ACCOUNTS_URL?.trim()) throw new Error("ACCOUNTS_URL is not configured");
  if (!env.TOKEN_ENCRYPTION_KEYS?.trim()) {
    throw new Error("TOKEN_ENCRYPTION_KEYS is not configured");
  }
}

function resolveKeyring(deps: LinkAccountDeps): TokenKeyring {
  return deps.keyring ?? parseTokenEncryptionKeys(deps.env.TOKEN_ENCRYPTION_KEYS);
}

function randomBase64Url(byteLength: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(byteLength))).toString("base64url");
}

/** 128-bit random state. */
export function generateState(): string {
  return randomBase64Url(16);
}

/** PKCE code_verifier (43–128 chars of unreserved). */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Start the Authorization Code + PKCE linking flow for a verified Chat identity.
 * Returns the accounts.gdgs.jp authorization URL to send in Chat.
 */
export async function createLinkAuthorizationUrl(
  input: {
    platform: ChatPlatform;
    chatUserId: string;
    spaceId?: string;
  },
  deps: LinkAccountDeps,
): Promise<string> {
  requireEnv(deps.env);
  if (!input.chatUserId) throw new Error("chatUserId is required");

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(codeVerifier);
  const createdAt = nowFn(deps);

  const record: LinkStateRecord = {
    platform: input.platform,
    chatUserId: input.chatUserId,
    codeVerifier,
    spaceId: input.spaceId ?? "",
    createdAt,
  };

  await deps.redis.set(linkStateKey(state), JSON.stringify(record), "EX", STATE_TTL_SECONDS);

  const url = new URL(authorizeUrl(deps.env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", deps.env.IDP_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Atomically consume a single-use `state` record.
 * Returns null when missing, expired, or already consumed.
 */
export async function consumeLinkState(
  state: string,
  redis: LinkRedis,
): Promise<LinkStateRecord | null> {
  if (!state) return null;
  const raw = await redis.getdel(linkStateKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LinkStateRecord;
    if (
      typeof parsed.platform !== "string" ||
      typeof parsed.chatUserId !== "string" ||
      typeof parsed.codeVerifier !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  deps: LinkAccountDeps,
): Promise<TokenResponse> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(tokenUrl(deps.env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(deps.env),
    },
    body,
  });

  const json = (await response.json()) as TokenResponse;
  if (
    !response.ok ||
    typeof json.access_token !== "string" ||
    !json.access_token ||
    typeof json.refresh_token !== "string" ||
    !json.refresh_token
  ) {
    throw new Error("token_exchange_failed");
  }
  return json;
}

async function refreshAccessToken(
  refreshToken: string,
  deps: LinkAccountDeps,
): Promise<TokenResponse> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetchImpl(tokenUrl(deps.env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(deps.env),
    },
    body,
  });

  let json: TokenResponse;
  try {
    json = (await response.json()) as TokenResponse;
  } catch {
    throw new Error("refresh_failed");
  }
  if (!response.ok) {
    if (json.error === "invalid_grant") throw new InvalidGrantError();
    throw new Error("refresh_failed");
  }
  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("refresh_failed");
  }
  if (
    json.refresh_token !== undefined &&
    (typeof json.refresh_token !== "string" || !json.refresh_token)
  ) {
    throw new Error("refresh_failed");
  }
  return json;
}

async function fetchSubject(accessToken: string, deps: LinkAccountDeps): Promise<string | null> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    const response = await fetchImpl(userInfoUrl(deps.env), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as UserInfoResponse;
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

async function writeLinkRecord(record: StoredLinkRecord, deps: LinkAccountDeps): Promise<void> {
  await deps.redis.set(
    linkUserKey(record.platform, record.chatUserId),
    JSON.stringify(record),
    "EX",
    // Bound Redis retention near the refresh-token lifetime (30 days) + slack.
    LINK_RECORD_TTL_SECONDS,
  );
}

async function readLinkRecord(
  platform: ChatPlatform,
  chatUserId: string,
  redis: LinkRedis,
): Promise<ReadLinkRecord | null> {
  const raw = await redis.get(linkUserKey(platform, chatUserId));
  if (!raw) return null;
  try {
    return { record: JSON.parse(raw) as StoredLinkRecord, serialized: raw };
  } catch {
    return null;
  }
}

async function needsLink(
  platform: ChatPlatform,
  chatUserId: string,
  deps: LinkAccountDeps,
  spaceId?: string,
): Promise<LinkedTokenNeedsLink> {
  return {
    status: "needs_link",
    authorizationUrl: await createLinkAuthorizationUrl({ platform, chatUserId, spaceId }, deps),
  };
}

async function resolveRefreshWinner(
  platform: ChatPlatform,
  recordUserId: string,
  deps: LinkAccountDeps,
  now: number,
  spaceId?: string,
  /** Who should receive a linking prompt if the record vanishes. Defaults to recordUserId. */
  promptUserId?: string,
): Promise<LinkedTokenResult> {
  const linkFor = promptUserId ?? recordUserId;
  // A competing refresh normally finishes quickly. Briefly re-read so callers
  // can share its winner without issuing another rotating refresh request.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const winner = await readLinkRecord(platform, recordUserId, deps.redis);
    if (!winner) return needsLink(platform, linkFor, deps, spaceId);
    if (winner.record.accessTokenExpiresAt > now + ACCESS_TOKEN_REFRESH_SKEW_SECONDS) {
      try {
        return {
          status: "ok",
          accessToken: await decryptToken(winner.record.accessToken, resolveKeyring(deps)),
        };
      } catch {
        return { status: "temporarily_unavailable" };
      }
    }
    if (!winner.record.refreshLease || winner.record.refreshLease.expiresAt <= now) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return { status: "temporarily_unavailable" };
}

/**
 * Complete the OAuth callback: exchange `code` using the consumed state and
 * bind tokens to the Chat identity recovered from Redis — never from query params.
 */
export async function completeAccountLink(
  input: { code: string; state: string },
  deps: LinkAccountDeps,
): Promise<
  | { ok: true; platform: ChatPlatform; chatUserId: string; subject: string | null }
  | { ok: false; reason: "missing_params" | "invalid_state" | "token_exchange_failed" }
> {
  requireEnv(deps.env);
  if (!input.code || !input.state) {
    return { ok: false, reason: "missing_params" };
  }

  const linkState = await consumeLinkState(input.state, deps.redis);
  if (!linkState) {
    return { ok: false, reason: "invalid_state" };
  }

  let tokens: TokenResponse;
  try {
    tokens = await exchangeAuthorizationCode(input.code, linkState.codeVerifier, deps);
  } catch {
    return { ok: false, reason: "token_exchange_failed" };
  }

  const keyring = resolveKeyring(deps);
  const encryptedAccess = await encryptToken(tokens.access_token as string, keyring);
  const encryptedRefresh = await encryptToken(tokens.refresh_token as string, keyring);
  const now = nowFn(deps);
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
  const subject = await fetchSubject(tokens.access_token as string, deps);

  const record: StoredLinkRecord = {
    platform: linkState.platform,
    chatUserId: linkState.chatUserId,
    accessToken: encryptedAccess,
    accessTokenExpiresAt: now + expiresIn,
    refreshToken: encryptedRefresh,
    subject,
    linkedAt: now,
  };
  await writeLinkRecord(record, deps);

  // First Discord member to link in a guild becomes that guild's shared credential.
  if (linkState.platform === "discord" && linkState.spaceId) {
    await deps.redis.setNX(
      linkGuildKey("discord", linkState.spaceId),
      linkState.chatUserId,
      LINK_RECORD_TTL_SECONDS,
    );
  }

  return {
    ok: true,
    platform: linkState.platform,
    chatUserId: linkState.chatUserId,
    subject,
  };
}

/**
 * Return a usable access token for Wiki API calls, refreshing when under 60 s remain.
 * Missing link or `invalid_grant` → `needs_link` with a fresh authorization URL.
 * Operational and malformed-response failures preserve the record and return
 * `temporarily_unavailable` so callers can retry safely.
 *
 * On Discord, when the invoker has no personal link but `options.spaceId` (guild id)
 * is set, falls back to the first member who linked in that guild.
 */
export async function getLinkedToken(
  platform: ChatPlatform,
  chatUserId: string,
  deps: LinkAccountDeps,
  options?: { spaceId?: string },
): Promise<LinkedTokenResult> {
  requireEnv(deps.env);

  let stored = await readLinkRecord(platform, chatUserId, deps.redis);
  let recordUserId = chatUserId;

  if (!stored && platform === "discord" && options?.spaceId) {
    const ownerId = await deps.redis.get(linkGuildKey(platform, options.spaceId));
    if (ownerId) {
      stored = await readLinkRecord(platform, ownerId, deps.redis);
      if (stored) {
        recordUserId = ownerId;
      } else {
        // Pointer left behind after the owner's record was cleaned up (e.g. invalid_grant).
        await deps.redis.del(linkGuildKey(platform, options.spaceId));
      }
    }
  }

  if (!stored) return needsLink(platform, chatUserId, deps, options?.spaceId);

  const now = nowFn(deps);
  if (stored.record.accessTokenExpiresAt > now + ACCESS_TOKEN_REFRESH_SKEW_SECONDS) {
    try {
      return {
        status: "ok",
        accessToken: await decryptToken(stored.record.accessToken, resolveKeyring(deps)),
      };
    } catch {
      return { status: "temporarily_unavailable" };
    }
  }

  const keyring = resolveKeyring(deps);
  if (stored.record.refreshLease && stored.record.refreshLease.expiresAt > now) {
    return resolveRefreshWinner(platform, recordUserId, deps, now, options?.spaceId, chatUserId);
  }

  let refreshPlain: string;
  try {
    refreshPlain = await decryptToken(stored.record.refreshToken, keyring);
  } catch {
    return { status: "temporarily_unavailable" };
  }

  const claimedRecord: StoredLinkRecord = {
    ...stored.record,
    refreshLease: {
      owner: generateState(),
      expiresAt: now + REFRESH_LEASE_SECONDS,
    },
  };
  const claimedSerialized = JSON.stringify(claimedRecord);
  const claimed = await deps.redis.compareAndSet(
    linkUserKey(platform, recordUserId),
    stored.serialized,
    claimedSerialized,
    LINK_RECORD_TTL_SECONDS,
  );
  if (!claimed) {
    return resolveRefreshWinner(platform, recordUserId, deps, now, options?.spaceId, chatUserId);
  }

  let tokens: TokenResponse;
  try {
    tokens = await refreshAccessToken(refreshPlain, deps);
  } catch (err) {
    if (!(err instanceof InvalidGrantError)) {
      await deps.redis.compareAndSet(
        linkUserKey(platform, recordUserId),
        claimedSerialized,
        stored.serialized,
        LINK_RECORD_TTL_SECONDS,
      );
      return { status: "temporarily_unavailable" };
    }

    const current = await readLinkRecord(platform, recordUserId, deps.redis);
    if (!current) return needsLink(platform, chatUserId, deps, options?.spaceId);
    if (current.serialized !== claimedSerialized) {
      return resolveRefreshWinner(platform, recordUserId, deps, now, options?.spaceId, chatUserId);
    }

    const deleted = await deps.redis.compareAndDelete(
      linkUserKey(platform, recordUserId),
      claimedSerialized,
    );
    if (deleted) return needsLink(platform, chatUserId, deps, options?.spaceId);
    return resolveRefreshWinner(platform, recordUserId, deps, now, options?.spaceId, chatUserId);
  }

  // Lazy re-encrypt both tokens under the current key version on every successful refresh.
  const nextRefreshPlain = tokens.refresh_token ?? refreshPlain;
  const encryptedAccess = await encryptToken(tokens.access_token as string, keyring);
  const encryptedRefresh = await encryptToken(nextRefreshPlain, keyring);
  const expiresIn = typeof tokens.expires_in === "number" ? tokens.expires_in : 3600;
  const updated: StoredLinkRecord = {
    ...stored.record,
    accessToken: encryptedAccess,
    accessTokenExpiresAt: now + expiresIn,
    refreshToken: encryptedRefresh,
  };
  updated.refreshLease = undefined;
  const updatedSerialized = JSON.stringify(updated);
  const written = await deps.redis.compareAndSet(
    linkUserKey(platform, recordUserId),
    claimedSerialized,
    updatedSerialized,
    LINK_RECORD_TTL_SECONDS,
  );
  if (!written) {
    return resolveRefreshWinner(platform, recordUserId, deps, now, options?.spaceId, chatUserId);
  }

  return { status: "ok", accessToken: tokens.access_token as string };
}

/**
 * Revoke the refresh token at the IdP, then atomically delete the exact record
 * that supplied it. Failures preserve encrypted token material for a safe retry.
 */
export async function unlinkAccount(
  platform: ChatPlatform,
  chatUserId: string,
  deps: LinkAccountDeps,
): Promise<{ revoked: boolean }> {
  requireEnv(deps.env);

  const stored = await readLinkRecord(platform, chatUserId, deps.redis);
  if (!stored) {
    return { revoked: false };
  }

  const keyring = resolveKeyring(deps);
  let refreshPlain: string | null = null;
  try {
    refreshPlain = await decryptToken(stored.record.refreshToken, keyring);
  } catch {
    refreshPlain = null;
  }

  if (!refreshPlain) {
    return { revoked: false };
  }

  const fetchImpl = deps.fetch ?? fetch;
  try {
    const response = await fetchImpl(revokeUrl(deps.env), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(deps.env),
      },
      body: new URLSearchParams({
        token: refreshPlain,
        token_type_hint: "refresh_token",
      }),
    });
    if (!response.ok) return { revoked: false };
    const deleted = await deps.redis.compareAndDelete(
      linkUserKey(platform, chatUserId),
      stored.serialized,
    );
    return { revoked: deleted };
  } catch {
    return { revoked: false };
  }
}

/** Build deps from process env + shared Redis client. */
export function linkAccountDepsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<LinkAccountDeps> = {},
): LinkAccountDeps {
  return {
    env: {
      IDP_CLIENT_ID: env.IDP_CLIENT_ID ?? "",
      IDP_CLIENT_SECRET: env.IDP_CLIENT_SECRET ?? "",
      ACCOUNTS_URL: env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp",
      TOKEN_ENCRYPTION_KEYS: env.TOKEN_ENCRYPTION_KEYS ?? "",
    },
    redis: overrides.redis ?? createLinkRedis(getRedis(env.REDIS_URL)),
    fetch: overrides.fetch,
    nowSeconds: overrides.nowSeconds,
    keyring: overrides.keyring,
  };
}

/**
 * HTTP handler for `GET /auth/callback`.
 * Query params other than `code` / `state` are ignored — do not log the URL.
 */
export async function handleAuthCallback(
  request: Request,
  deps: LinkAccountDeps = linkAccountDepsFromEnv(),
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return authCallbackHtml(400, "Linking was cancelled or denied.");
  }

  if (!code || !state) {
    return authCallbackHtml(400, "Missing authorization response.");
  }

  // Intentionally ignore chatUserId / platform query params — binding is Redis state only.
  const result = await completeAccountLink({ code, state }, deps);

  if (!result.ok) {
    // invalid_state covers unknown, expired, and already-consumed state — no token exchange.
    return authCallbackHtml(400, "This linking link is invalid or has already been used.");
  }

  return authCallbackHtml(
    200,
    "Your Chat account is now linked to GDG Accounts. You can close this window and return to Chat.",
  );
}

function authCallbackHtml(status: number, message: string): Response {
  const title = status === 200 ? "Account linked" : "Linking failed";
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
