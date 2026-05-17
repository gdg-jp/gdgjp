import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, { value: UserChapter | null; expiresAt: number }>();

/**
 * Returns the user's primary chapter membership, refreshed at most every
 * CACHE_TTL_MS by calling the IdP's /userinfo endpoint.
 *
 * Takes the Request so we can pull access/refresh tokens from the signed
 * session cookie (no DB account table after PR 2). Cache key is the session
 * user id derived from the cookie inside getFreshClaims.
 */
export async function fetchChapterForUser(env: Env, request: Request): Promise<UserChapter | null> {
  // Resolve the cache key from the session cookie up front, so calls without
  // a session bypass the cache and propagate the no-session error.
  const user = await getAuth(env).getSessionUser(request);
  if (!user) return null;

  const now = Date.now();
  const hit = cache.get(user.id);
  if (hit && hit.expiresAt > now) return hit.value;

  const claims = await getAuth(env).getFreshClaims(request);
  if (cache.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | undefined;
    let oldestExp = Number.POSITIVE_INFINITY;
    for (const [k, v] of cache) {
      if (v.expiresAt < oldestExp) {
        oldestExp = v.expiresAt;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(user.id, { value: claims.chapter, expiresAt: now + CACHE_TTL_MS });
  return claims.chapter;
}
