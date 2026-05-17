// IdP auth entry. Replaces the better-auth-based `initializeIdpAuth` with:
//   - getIdpSession(request): reads the signed-cookie IdP login session
//   - requireIdpUser(request): same, throws 401 if absent
//   - getOAuthHelpers(env): bound OAuthHelpers from @cloudflare/workers-oauth-provider
//
// Trusted OAuth clients (tinyurl/wiki/img/scheduler) are seeded into KV by
// scripts/seed-clients.ts; they're no longer loaded at request time.

import type { AuthUser } from "@gdgjp/gdg-lib";
import { readIdpSession } from "./idp-session.server";
import { getOAuthHelpers } from "./oauth-provider.server";

export { getOAuthHelpers };

/**
 * Resolves the current IdP login session. Uses the signed cookie only for
 * identity (userId) and re-reads the user row from D1 to get a fresh
 * `is_admin` plus the canonical name/image — the cookie has a 14-day max
 * age, so trusting `isAdmin` from it would let demoted admins keep super-
 * admin powers for up to two weeks (and would propagate through
 * `requireUser` → `requireSuperAdmin`).
 *
 * Returns null if the session is missing OR if the user row has been
 * deleted since the cookie was issued.
 */
export async function getSessionUser(env: Env, request: Request): Promise<AuthUser | null> {
  const session = await readIdpSession(request, env.IDP_SESSION_SECRET);
  if (!session) return null;
  const row = await env.DB.prepare(
    `SELECT id, email, name, image, is_admin FROM "user" WHERE id = ? LIMIT 1`,
  )
    .bind(session.userId)
    .first<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      is_admin: number;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    isAdmin: row.is_admin === 1,
  };
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  const user = await getSessionUser(env, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}
