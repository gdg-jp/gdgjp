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

export async function getSessionUser(env: Env, request: Request): Promise<AuthUser | null> {
  const session = await readIdpSession(request, env.IDP_SESSION_SECRET);
  if (!session) return null;
  // We don't carry name/picture in the session cookie; for places that need
  // them, callers should hit the user table directly. AuthUser only requires
  // id/email/name/isAdmin — backfill name from email if needed by callers.
  return {
    id: session.userId,
    email: session.email,
    name: session.email,
    image: null,
    isAdmin: session.isAdmin,
  };
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  const user = await getSessionUser(env, request);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

/**
 * Fetch the full user row (with name/image) for routes that render profile UI.
 * Returns null if the session is absent or the user row was deleted.
 */
export async function getSessionUserFull(
  env: Env,
  request: Request,
): Promise<(AuthUser & { image: string | null }) | null> {
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
    isAdmin: row.is_admin === 1,
    image: row.image,
  };
}
