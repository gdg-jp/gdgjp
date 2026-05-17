import type { AuthUser } from "@gdgjp/gdg-lib";
import { redirect } from "react-router";
import { createAuth } from "./auth.server";

export type { AuthUser };

/**
 * Returns the current session user, or null if not signed in.
 */
export function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  return createAuth(env).getSessionUser(request);
}

/**
 * Require an authenticated session. Throws a redirect to /login if not signed in.
 * Does NOT enforce admin or chapter membership — wiki delegates those to the
 * accounts IdP and consumes the resulting isAdmin claim via user.isAdmin.
 */
export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await getSessionUser(request, env);
  if (!user) throw redirect("/login");
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
