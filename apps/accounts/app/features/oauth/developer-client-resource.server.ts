import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
import { decodeBasicCredentials } from "better-auth/oauth2";

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
const TOKEN_PATH = "/api/auth/oauth2/token";
const FORM_MEDIA_TYPE = /^application\/x-www-form-urlencoded\s*(;|$)/i;
const REFUSAL = "resource indicators are available only to first-party clients";

type ClientRow = { developer: number; redirectUris: string };

export async function refuseDeveloperClientResource(
  env: Pick<Env, "DB" | "APP_URL">,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === AUTHORIZE_PATH) return refuseAuthorization(env, request, url);
  if (url.pathname === TOKEN_PATH) return refuseTokenRequest(env.DB, request);
  return null;
}

export async function formParameters(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get("content-type")?.match(FORM_MEDIA_TYPE)) {
    return new URLSearchParams();
  }
  return new URLSearchParams(await request.clone().text());
}

async function refuseAuthorization(
  env: Pick<Env, "DB" | "APP_URL">,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const params = request.method === "POST" ? await formParameters(request) : url.searchParams;
  if (!params.has("resource")) return null;
  const clientId = soleValue(params, "client_id");
  const client = clientId === null ? null : await findClient(env.DB, clientId);
  if (client?.developer === 0) return null;
  const redirectUri = soleValue(params, "redirect_uri");
  const registered: unknown = JSON.parse(client?.redirectUris ?? "null");
  if (!redirectUri || !Array.isArray(registered) || !registered.includes(redirectUri)) {
    return invalidTarget();
  }
  const target = new URL(redirectUri);
  target.searchParams.set("error", "invalid_target");
  target.searchParams.set("error_description", REFUSAL);
  const state = soleValue(params, "state");
  if (state) target.searchParams.set("state", state);
  target.searchParams.set("iss", new URL(env.APP_URL).origin);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}

async function refuseTokenRequest(db: D1Database, request: Request): Promise<Response | null> {
  const params = await formParameters(request);
  const code = params.get("grant_type") === "authorization_code" ? soleValue(params, "code") : null;
  if (!params.has("resource") && code === null) return null;
  const clientId = tokenClientId(request.headers.get("authorization"), params);
  const client = clientId === null ? null : await findClient(db, clientId);
  if (client?.developer === 0) return null;
  if (params.has("resource")) return invalidTarget();
  if (code === null) return null;
  return (await codeStoresResource(db, code)) ? invalidTarget() : null;
}

async function codeStoresResource(db: D1Database, code: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT CASE WHEN json_valid("value") THEN
                COALESCE(json_type("value", '$.resource') NOT IN ('null')
                  AND NOT (json_type("value", '$.resource') = 'array'
                           AND json_array_length("value", '$.resource') = 0), 0)
                OR json_type("value", '$.query.resource') IS NOT NULL
              ELSE 0 END AS stored
       FROM "verification"
       WHERE "identifier" = ?`,
    )
    .bind(await storedCodeIdentifier(code))
    .first<{ stored: number }>();
  return row?.stored === 1;
}

async function storedCodeIdentifier(code: string): Promise<string> {
  const digest = await createHash("SHA-256").digest(new TextEncoder().encode(code));
  return base64Url.encode(new Uint8Array(digest), { padding: false });
}

function tokenClientId(authorization: string | null, params: URLSearchParams): string | null {
  const bodyIds = params.getAll("client_id").filter((value) => value.length > 0);
  if (bodyIds.length > 1) return null;
  if (params.has("client_assertion") || params.has("client_assertion_type")) return null;
  if (!authorization) return bodyIds[0] ?? null;
  let basicId: string;
  try {
    basicId = decodeBasicCredentials(authorization).clientId;
  } catch {
    return null;
  }
  return bodyIds.every((id) => id === basicId) ? basicId : null;
}

function soleValue(params: URLSearchParams, name: string): string | null {
  const values = params.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

function findClient(db: D1Database, clientId: string): Promise<ClientRow | null> {
  return db
    .prepare(
      `SELECT "userId" IS NOT NULL AS developer,
              CASE WHEN json_valid("redirectUris") THEN "redirectUris" ELSE 'null' END
                AS redirectUris
       FROM "oauthClient"
       WHERE "clientId" = ?`,
    )
    .bind(clientId)
    .first<ClientRow>();
}

function invalidTarget(): Response {
  return Response.json(
    { error: "invalid_target", error_description: REFUSAL },
    { status: 400, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
