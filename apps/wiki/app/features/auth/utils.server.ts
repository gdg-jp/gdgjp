import type { AuthUser } from "@gdgjp/gdg-lib";
import { createAuth } from "./auth.server";
import { buildSignInRedirect } from "./redirect";

export type { AuthUser };

export interface AccessIdentity {
  user: AuthUser | null;
  chapterIds: string[];
  chapters: Array<{ chapterId: string; chapterSlug: string; role: string }>;
  claimsAvailable: boolean;
}

const CLAIMS_CACHE_TTL_MS = 30_000;
const CLAIMS_CACHE_MAX_SIZE = 500;

type CachedChapters = {
  chapterIds: string[];
  chapters: AccessIdentity["chapters"];
};

const chapterClaimsCache = new Map<string, { value: CachedChapters; expiresAt: number }>();

/**
 * Returns the current session user, or null if not signed in.
 */
export function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  return createAuth(env).getSessionUser(request);
}

/**
 * Resolve the identity used by page authorization. Chapter memberships are
 * fetched from IdP claims and cached briefly so in-app navigations are not
 * blocked by a /userinfo round-trip on every click. Removals still take effect
 * within CLAIMS_CACHE_TTL_MS instead of waiting for the 30-day RP session cookie.
 */
export async function getAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const auth = createAuth(env);
  const user = await auth.getSessionUser(request);
  if (!user) return { user: null, chapterIds: [], chapters: [], claimsAvailable: true };

  const now = Date.now();
  const hit = chapterClaimsCache.get(user.id);
  if (hit && hit.expiresAt > now) {
    return { user, ...hit.value, claimsAvailable: true };
  }

  try {
    const claims = await auth.getFreshClaims(request);
    const value: CachedChapters = {
      chapterIds: claims.chapters.map((chapter) => String(chapter.chapterId)),
      chapters: claims.chapters.map((chapter) => ({
        chapterId: String(chapter.chapterId),
        chapterSlug: chapter.chapterSlug,
        role: chapter.role,
      })),
    };
    if (chapterClaimsCache.size >= CLAIMS_CACHE_MAX_SIZE) {
      let oldestKey: string | undefined;
      let oldestExp = Number.POSITIVE_INFINITY;
      for (const [key, entry] of chapterClaimsCache) {
        if (entry.expiresAt < oldestExp) {
          oldestExp = entry.expiresAt;
          oldestKey = key;
        }
      }
      if (oldestKey !== undefined) chapterClaimsCache.delete(oldestKey);
    }
    chapterClaimsCache.set(user.id, { value, expiresAt: now + CLAIMS_CACHE_TTL_MS });
    return { user, ...value, claimsAvailable: true };
  } catch (error) {
    console.error("[access] unable to refresh chapter claims", error);
    // Prefer a recently-expired cache over fail-closed empty chapters so a
    // transient IdP blip does not blank the shell mid-navigation.
    if (hit) return { user, ...hit.value, claimsAvailable: true };
    return { user, chapterIds: [], chapters: [], claimsAvailable: false };
  }
}

/** Test helper — clears the in-isolate chapter-claims cache. */
export function clearChapterClaimsCacheForTests(): void {
  chapterClaimsCache.clear();
}

/**
 * Require an authenticated session. Starts the accounts IdP sign-in flow if not signed in.
 * Does NOT enforce admin or chapter membership — wiki delegates those to the
 * accounts IdP and consumes the resulting isAdmin claim via user.isAdmin.
 */
export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await getSessionUser(request, env);
  if (!user) throw buildSignInRedirect(request);
  return user;
}

/**
 * Require an authenticated session AND user.isAdmin === true. The isAdmin flag
 * is mirrored from the accounts IdP at sign-in; it can be stale until the user
 * signs out and back in. For live checks, use createAuth(env).getFreshClaims().
 */
export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new Response(null, { status: 403 });
  return user;
}
