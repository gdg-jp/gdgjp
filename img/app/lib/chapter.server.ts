import { ClaimsUnavailableError, type UserChapter } from "@gdgjp/gdg-lib";
import { getAuth } from "~/lib/auth.server";

export type { UserChapter };
export { ClaimsUnavailableError };

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, { value: UserChapter | null; expiresAt: number }>();

export async function fetchChapterForUser(
  env: Env,
  imgUserId: string,
): Promise<UserChapter | null> {
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
  cache.set(imgUserId, { value: claims.chapter, expiresAt: now + CACHE_TTL_MS });
  return claims.chapter;
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
