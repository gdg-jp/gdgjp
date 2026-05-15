import { redirect } from "react-router";
import { type AuthUser, createAuth } from "./auth.server";

/**
 * Returns the current session user, or null if not signed in.
 */
export async function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
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
 * is mirrored from the accounts IdP at sign-in via mapProfileToUser; it can be
 * stale until the user signs out and back in.
 */
export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (!user.isAdmin) throw new Response(null, { status: 403 });
  return user;
}
