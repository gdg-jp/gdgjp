import { CLI_SCOPE } from "~/lib/auth.server";
import type { Route } from "./+types/api.cli.logout";

const CLI_CLIENT_ID = "gdg-cli";

type AccessTokenRow = {
  refreshId: string | null;
  scopes: string;
};

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const token = bearerToken(request);
  if (!token) return unauthorized();

  const tokenHash = await hashAccessToken(token);
  const row = await context.cloudflare.env.DB.prepare(
    `SELECT refreshId, scopes
     FROM oauthAccessToken
     WHERE token = ? AND clientId = ? AND expiresAt > ?
     LIMIT 1`,
  )
    .bind(tokenHash, CLI_CLIENT_ID, new Date().toISOString())
    .first<AccessTokenRow>();
  if (!row || !hasScope(row.scopes, CLI_SCOPE)) return unauthorized();

  if (row.refreshId) {
    await context.cloudflare.env.DB.prepare("DELETE FROM oauthRefreshToken WHERE id = ?")
      .bind(row.refreshId)
      .run();
  } else {
    await context.cloudflare.env.DB.prepare("DELETE FROM oauthAccessToken WHERE token = ?")
      .bind(tokenHash)
      .run();
  }
  return new Response(null, { status: 204 });
}

function bearerToken(request: Request): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers.get("Authorization") ?? "");
  return match?.[1] ?? null;
}

/** Better Auth stores OAuth access tokens as unpadded base64url SHA-256 hashes. */
async function hashAccessToken(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
