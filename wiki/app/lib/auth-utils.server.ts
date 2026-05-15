import { redirect } from "react-router";
import { createAuth } from "./auth.server";

export type Role = "admin" | "lead" | "member" | "viewer";

const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 4,
  lead: 3,
  member: 2,
  viewer: 1,
};

/**
 * Returns true if the given userRole meets or exceeds minRole in the hierarchy.
 * Unknown roles are treated as having no permissions (level 0).
 */
export function hasRole(userRole: string, minRole: Role): boolean {
  return (ROLE_HIERARCHY[userRole as Role] ?? 0) >= ROLE_HIERARCHY[minRole];
}

/**
 * Asserts the current user is authenticated and has at least `minRole`.
 * Throws a redirect to /login if unauthenticated, or a 403 Response if unauthorized.
 * Returns the typed session user on success.
 */
export async function requireRole(request: Request, env: Env, minRole: Role) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");
  if (session.user.role === "pending") throw redirect("/pending");
  if (session.user.role === "viewer") throw redirect("/pending");
  if (!hasRole(session.user.role as string, minRole)) {
    throw new Response(null, { status: 403 });
  }
  return session.user;
}

/**
 * Returns the current session user or null — does not throw.
 */
export async function getSessionUser(request: Request, env: Env) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}
