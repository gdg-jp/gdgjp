import {
  type TokenResponse,
  authorizeUrl,
  exchangeAuthorizationCode,
  fetchSubject,
} from "./accounts-client";
import type {
  ChatPlatform,
  LinkAccountDeps,
  LinkRedis,
  LinkStateRecord,
  StoredLinkRecord,
} from "./contracts";
import { nowFn, requireEnv, resolveKeyring } from "./environment";
import { linkGuildKey, linkStateKey } from "./keys";
import { writeLinkRecord } from "./records";
import { LINK_RECORD_TTL_SECONDS, OAUTH_SCOPES, REDIRECT_URI, STATE_TTL_SECONDS } from "./settings";
import { encryptToken } from "./token-crypto";
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
