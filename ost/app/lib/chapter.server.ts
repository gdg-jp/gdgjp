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

const DEV_CHAPTERS_COOKIE = "ost-dev-chapters";

/** Parse the dev-login chapter override cookie. Non-production only. */
function readDevChapters(request: Request): UserChapters | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${DEV_CHAPTERS_COOKIE}=`));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(DEV_CHAPTERS_COOKIE.length + 1)));
    if (!Array.isArray(parsed)) return null;
    const all = parsed as UserChapter[];
    return { primary: all[0] ?? null, all };
  } catch {
    return null;
  }
}

/**
 * The user's chapter memberships, refreshed at most every CACHE_TTL_MS by
 * calling the IdP's /userinfo endpoint via the signed session cookie's tokens.
 *
 * In non-production, an `ost-dev-chapters` cookie (JSON UserChapter[]) set by
 * `/dev/login` short-circuits the IdP call so local dev + e2e can exercise
 * chapter-gated routes without a real Google login.
 */
export async function fetchChaptersForUser(env: Env, request: Request): Promise<UserChapters> {
  const user = await getAuth(env).getSessionUser(request);
  if (!user) return { primary: null, all: [] };

  if (env.ENVIRONMENT !== "production") {
    const dev = readDevChapters(request);
    if (dev) return dev;
  }

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
