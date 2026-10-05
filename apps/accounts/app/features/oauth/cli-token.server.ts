import { CLI_SCOPE } from "~/features/auth/auth.server";
import { sha256Base64Url } from "~/lib/crypto.server";

const CLI_CLIENT_ID = "gdg-cli";

export async function requireCliTokenUser(
  env: Env,
  authorization: string,
): Promise<{ id: string }> {
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
  if (!token) throw unauthorized();
  const row = await env.DB.prepare(
    `SELECT userId, scopes
     FROM oauthAccessToken
     WHERE token = ? AND clientId = ? AND expiresAt > ? AND userId IS NOT NULL
     LIMIT 1`,
  )
    .bind(await sha256Base64Url(token), CLI_CLIENT_ID, new Date().toISOString())
    .first<{ userId: string; scopes: string }>();
  if (!row || !hasScope(row.scopes, CLI_SCOPE)) throw unauthorized();
  return { id: row.userId };
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
