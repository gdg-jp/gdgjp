import type { Route } from "./+types/api.users.search";

type AccessTokenRow = { userId: string };
type UserRow = { id: string; name: string; email: string; image: string | null };

/**
 * Returns Accounts users for the SNS contributor picker. A current SNS OAuth
 * token is required so the Accounts directory is never exposed anonymously.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const token = bearerToken(request);
  if (!token) return unauthorized();

  const { env } = context.cloudflare;
  const accessToken = await env.DB.prepare(
    `SELECT userId
     FROM oauthAccessToken
     WHERE token = ? AND clientId = ? AND expiresAt > ? AND userId IS NOT NULL
     LIMIT 1`,
  )
    .bind(token, env.SNS_CLIENT_ID, new Date().toISOString())
    .first<AccessTokenRow>();
  if (!accessToken) return unauthorized();

  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (!query) return Response.json({ users: [] });

  const pattern = `%${query}%`;
  const result = await env.DB.prepare(
    `SELECT id, name, email, image
     FROM "user"
     WHERE name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE
     ORDER BY name COLLATE NOCASE, email COLLATE NOCASE
     LIMIT 12`,
  )
    .bind(pattern, pattern)
    .all<UserRow>();

  return Response.json({ users: result.results });
}

function bearerToken(request: Request): string | null {
  return /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
}

function unauthorized(): Response {
  return Response.json({ error: "invalid_token" }, { status: 401 });
}
