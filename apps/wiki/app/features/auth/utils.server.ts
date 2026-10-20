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

/**
 * Returns the current session user, or null if not signed in.
 */
export function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  return createAuth(env).getSessionUser(request);
}

/**
 * Resolve the identity used by page authorization. Chapter memberships come
 * from the same per-request accounts.gdgs.jp session check as the user, so a
 * membership change or sign-out applies on the next request.
 */
export async function getAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const auth = createAuth(env);
  const user = await auth.getSessionUser(request);
  if (!user) return { user: null, chapterIds: [], chapters: [], claimsAvailable: true };

  const claims = await auth.getFreshClaims(request);
  return {
    user,
    chapterIds: claims.chapters.map((chapter) => String(chapter.chapterId)),
    chapters: claims.chapters.map((chapter) => ({
      chapterId: String(chapter.chapterId),
      chapterSlug: chapter.chapterSlug,
      role: chapter.role,
    })),
    claimsAvailable: true,
  };
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
 * Require an authenticated session AND user.isAdmin === true. isAdmin is the
 * live accounts IdP claim for this request.
 */
export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new Response(null, { status: 403 });
  return user;
}
