import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

export type UserChapterClaims = {
  chapter: UserChapter | null;
  isAdmin: boolean;
};

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, { value: UserChapterClaims; expiresAt: number }>();

export async function fetchChapterClaimsForUser(
  env: Env,
  imgUserId: string,
): Promise<UserChapterClaims> {
  const now = Date.now();
  const hit = cache.get(imgUserId);
  if (hit && hit.expiresAt > now) return hit.value;

  const claims = await getAuth(env).getFreshClaims(imgUserId);
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
  const value: UserChapterClaims = { chapter: claims.chapter, isAdmin: claims.isAdmin };
  cache.set(imgUserId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function fetchChapterForUser(
  env: Env,
  imgUserId: string,
): Promise<UserChapter | null> {
  return (await fetchChapterClaimsForUser(env, imgUserId)).chapter;
}

export async function getLinkedAccountId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT accountId FROM account WHERE userId = ? AND providerId = 'gdgjp' ORDER BY createdAt DESC LIMIT 1`,
    )
    .bind(userId)
    .first<{ accountId: string }>();
  return row?.accountId ?? null;
}
