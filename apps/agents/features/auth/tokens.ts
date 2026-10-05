import {
  InvalidGrantError,
  type TokenResponse,
  basicAuthHeader,
  refreshAccessToken,
  revokeUrl,
} from "./accounts-client";
import { createLinkAuthorizationUrl, generateState } from "./authorization";
import type {
  ChatPlatform,
  LinkAccountDeps,
  LinkedTokenNeedsLink,
  LinkedTokenResult,
  StoredLinkRecord,
} from "./contracts";
import { nowFn, requireEnv, resolveKeyring } from "./environment";
import { linkGuildKey, linkUserKey } from "./keys";
import { readLinkRecord } from "./records";
import {
  ACCESS_TOKEN_REFRESH_SKEW_SECONDS,
  LINK_RECORD_TTL_SECONDS,
  REFRESH_LEASE_SECONDS,
} from "./settings";
import { decryptToken, encryptToken } from "./token-crypto";
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
