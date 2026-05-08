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

export async function fetchChaptersForUser(env: Env, tinyurlUserId: string): Promise<UserChapters> {
  const now = Date.now();
  const hit = cache.get(tinyurlUserId);
  if (hit && hit.expiresAt > now) return hit.value;

  const claims = await getAuth(env).getFreshClaims(tinyurlUserId);
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
  cache.set(tinyurlUserId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function fetchChapterForUser(
  env: Env,
  tinyurlUserId: string,
): Promise<UserChapter | null> {
  return (await fetchChaptersForUser(env, tinyurlUserId)).primary;
}
