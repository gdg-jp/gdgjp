const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";
const TOKEN_PATH = "/api/auth/oauth2/token";
const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;
const REFUSAL = "resource indicators are not available to developer-owned clients";

type ClientRow = { clientId: string; redirectUris: string };

export async function refuseDeveloperClientResource(
  env: Pick<Env, "DB" | "APP_URL">,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === AUTHORIZE_PATH) return refuseAuthorization(env, request, url);
  if (url.pathname === TOKEN_PATH) return refuseTokenRequest(env.DB, request);
  return null;
}

async function refuseAuthorization(
  env: Pick<Env, "DB" | "APP_URL">,
  request: Request,
  url: URL,
): Promise<Response | null> {
  const sources = [url.searchParams, await bodyParameters(request)];
  if (!sources.some((params) => params.has("resource"))) return null;
  const client = await findDeveloperClient(
    env.DB,
    sources.flatMap((params) => params.getAll("client_id")),
  );
  if (!client) return null;
  const params = sources.find((source) => source.has("redirect_uri")) ?? url.searchParams;
  const redirectUri = params.get("redirect_uri");
  const registered: unknown = JSON.parse(client.redirectUris);
  if (!redirectUri || !Array.isArray(registered) || !registered.includes(redirectUri)) {
    return invalidTarget();
  }
  const target = new URL(redirectUri);
  target.searchParams.set("error", "invalid_target");
  target.searchParams.set("error_description", REFUSAL);
  const state = params.get("state");
  if (state) target.searchParams.set("state", state);
  target.searchParams.set("iss", new URL(env.APP_URL).origin);
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}

async function refuseTokenRequest(db: D1Database, request: Request): Promise<Response | null> {
  const params = await bodyParameters(request);
  if (!params.has("resource")) return null;
  const clientIds = params.getAll("client_id");
  const basic = basicClientId(request.headers.get("authorization"));
  if (basic !== null) clientIds.push(basic);
  if (clientIds.length === 0) return invalidTarget();
  return (await findDeveloperClient(db, clientIds)) ? invalidTarget() : null;
}

function findDeveloperClient(db: D1Database, clientIds: string[]): Promise<ClientRow | null> {
  return db
    .prepare(
      `SELECT "clientId" AS clientId,
              CASE WHEN json_valid("redirectUris") THEN "redirectUris" ELSE 'null' END
                AS redirectUris
       FROM "oauthClient"
       WHERE "userId" IS NOT NULL AND "clientId" IN (SELECT value FROM json_each(?))
       LIMIT 1`,
    )
    .bind(JSON.stringify(clientIds))
    .first<ClientRow>();
}

async function bodyParameters(request: Request): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  const contentType = request.headers.get("content-type");
  if (!contentType) return params;
  for (const [key, value] of await bodyEntries(request, contentType)) {
    params.append(key, String(value));
  }
  return params;
}

async function bodyEntries(request: Request, contentType: string): Promise<[string, unknown][]> {
  try {
    if (JSON_CONTENT_TYPE.test(contentType)) {
      return Object.entries((await request.clone().json()) ?? {});
    }
    return [...(await request.clone().formData())];
  } catch {
    return [];
  }
}

function basicClientId(authorization: string | null): string | null {
  const match = authorization?.match(/^basic\s+(\S+)/i);
  if (!match?.[1]) return null;
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  const encoded = separator === -1 ? decoded : decoded.slice(0, separator);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function invalidTarget(): Response {
  return Response.json(
    { error: "invalid_target", error_description: REFUSAL },
    { status: 400, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
