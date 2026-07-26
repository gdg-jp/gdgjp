import { CLI_SCOPE } from "~/lib/auth.server";
import { listActiveChaptersForUser } from "~/lib/db";
import type { Route } from "./+types/api.cli.identity";

const CLI_CLIENT_ID = "gdg-cli";

type IdentityRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  isAdmin: number | boolean;
  scopes: string;
};

/**
 * Authenticates first-party CLI access tokens for relying-party service APIs.
 * This deliberately does not accept browser sessions or tokens from other clients.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = bearerToken(request);
  if (!token) return unauthorized();

  const identity = await context.cloudflare.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.image, u.is_admin AS isAdmin, t.scopes
     FROM oauthAccessToken t
     JOIN "user" u ON u.id = t.userId
     WHERE t.token = ? AND t.clientId = ? AND t.expiresAt > ?
     LIMIT 1`,
  )
    .bind(token, CLI_CLIENT_ID, new Date().toISOString())
    .first<IdentityRow>();

  if (!identity || !hasScope(identity.scopes, CLI_SCOPE)) return unauthorized();

  const chapters = await listActiveChaptersForUser(context.cloudflare.env.DB, identity.id);
  return Response.json({
    user: {
      id: identity.id,
      email: identity.email,
      name: identity.name,
      image: identity.image,
      isAdmin: identity.isAdmin === true || identity.isAdmin === 1,
    },
    chapters,
  });
}

function bearerToken(request: Request): string | null {
  return /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
}

function hasScope(value: string, required: string): boolean {
  try {
    const scopes: unknown = JSON.parse(value);
    return Array.isArray(scopes) && scopes.includes(required);
  } catch {
    return false;
  }
}

function unauthorized(): Response {
  return Response.json({ error: "invalid_token" }, { status: 401 });
}
