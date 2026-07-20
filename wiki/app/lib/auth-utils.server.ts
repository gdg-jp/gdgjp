import type { AuthUser } from "@gdgjp/gdg-lib";
import { buildSignInRedirect } from "./auth-redirect";
import { createAuth } from "./auth.server";

export type { AuthUser };

export interface AccessIdentity {
  user: AuthUser | null;
  chapterIds: string[];
  claimsAvailable: boolean;
}

/**
 * Returns the current session user, or null if not signed in.
 */
export function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  return createAuth(env).getSessionUser(request);
}

/**
 * Resolve the identity used by page authorization. Chapter memberships are
 * deliberately fetched from fresh IdP claims so a membership removal takes
 * effect without waiting for the 30-day RP session cookie to expire.
 */
export async function getAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const auth = createAuth(env);
  const user = await auth.getSessionUser(request);
  if (!user) return { user: null, chapterIds: [], claimsAvailable: true };

  try {
    const claims = await auth.getFreshClaims(request);
    return {
      user,
      chapterIds: claims.chapters.map((chapter) => String(chapter.chapterId)),
      claimsAvailable: true,
    };
  } catch (error) {
    console.error("[access] unable to refresh chapter claims", error);
    return { user, chapterIds: [], claimsAvailable: false };
  }
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
