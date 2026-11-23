import {
  parseAccessTokenAuthorization,
  stripAccessTokenAuthorizationScheme,
} from "better-auth/oauth2";
import { decodeJwt } from "jose";
import { formParameters } from "~/features/oauth/developer-client-resource.server";

const USERINFO_PATH = "/api/auth/oauth2/userinfo";
const INTROSPECT_PATH = "/api/auth/oauth2/introspect";
const TOKEN_PATH = "/api/auth/oauth2/token";
const GRANT_WITHOUT_CONSENT = "developer client token without consent";
const INVALID_ACCESS_TOKEN = "Invalid access token";
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function refuseDeveloperClientUserInfo(
  db: D1Database,
  request: Request,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== USERINFO_PATH) return null;
  const tokens = request.method === "POST" ? await formParameters(request) : new URLSearchParams();
  const header = parseAccessTokenAuthorization(request.headers.get("authorization"));
  if (header) tokens.append("access_token", header.token);
  if (!(await namesDeveloperClient(db, tokens.getAll("access_token")))) return null;
  return Response.json(
    { error: "invalid_token", error_description: INVALID_ACCESS_TOKEN },
    {
      status: 401,
      headers: {
        ...NO_STORE,
        "WWW-Authenticate": `Bearer error="invalid_token", error_description="${INVALID_ACCESS_TOKEN}"`,
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

export async function introspectsDeveloperClientJwt(
  db: D1Database,
  request: Request,
): Promise<boolean> {
  if (new URL(request.url).pathname !== INTROSPECT_PATH) return false;
  const tokens = (await formParameters(request)).getAll("token");
  return namesDeveloperClient(db, tokens.map(stripAccessTokenAuthorizationScheme));
}

export function inactiveIntrospection(): Response {
  return Response.json({ active: false }, { headers: NO_STORE });
}

export function grantRemovedDuringIssuance(request: Request, error: unknown): Response | null {
  if (new URL(request.url).pathname !== TOKEN_PATH) return null;
  if (!(error instanceof Error) || !error.message.includes(GRANT_WITHOUT_CONSENT)) return null;
  return Response.json(
    { error: "invalid_grant", error_description: "grant revoked during token issuance" },
    { status: 400, headers: NO_STORE },
  );
}

async function namesDeveloperClient(db: D1Database, tokens: string[]): Promise<boolean> {
  const clientIds = tokens.flatMap(authorizedParty);
  if (clientIds.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS developer FROM "oauthClient"
       WHERE "userId" IS NOT NULL AND "clientId" IN (SELECT value FROM json_each(?))
       LIMIT 1`,
    )
    .bind(JSON.stringify(clientIds))
    .first<{ developer: number }>();
  return row !== null;
}

function authorizedParty(token: string): string[] {
  try {
    const { azp } = decodeJwt(token);
    return typeof azp === "string" ? [azp] : [];
  } catch {
    return [];
  }
}
