import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapters = {
  primary: UserChapter | null;
  all: UserChapter[];
};

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, { value: UserChapters; expiresAt: number }>();

/**
 * Returns the user's chapter memberships, refreshed at most every
 * CACHE_TTL_MS by calling the IdP's /userinfo endpoint.
 *
 * Takes the Request so we can pull access/refresh tokens from the signed
 * session cookie (no DB account table after PR 2).
 */
export async function fetchChaptersForUser(env: Env, request: Request): Promise<UserChapters> {
  const user = await getAuth(env).getSessionUser(request);
  if (!user) return { primary: null, all: [] };

  const now = Date.now();
  const hit = cache.get(user.id);
  if (hit && hit.expiresAt > now) return hit.value;

  const claims = await getAuth(env).getFreshClaims(request);
  const value: UserChapters = { primary: claims.chapter, all: claims.chapters };
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
  cache.set(user.id, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function fetchChapterForUser(env: Env, request: Request): Promise<UserChapter | null> {
  return (await fetchChaptersForUser(env, request)).primary;
}
