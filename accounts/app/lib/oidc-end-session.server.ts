import { compactVerify, createRemoteJWKSet, decodeJwt } from "jose";
import { getAuth } from "./auth.server";

type OAuthClientRow = {
  clientId: string;
  disabled: number | boolean | null;
  enableEndSession: number | boolean | null;
  postLogoutRedirectUris: string | null;
};

type LogoutRequest = {
  clientId: string | null;
  confirm: boolean;
  idTokenHint: string | null;
  postLogoutRedirectUri: string | null;
  state: string | null;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** OIDC RP-Initiated Logout endpoint with GET query and POST form support. */
export async function handleOidcEndSession(env: Env, request: Request): Promise<Response> {
  const parsed = await parseLogoutRequest(request);
  if (parsed instanceof Response) return parsed;

  if (parsed.idTokenHint) return logoutWithIdToken(env, parsed);
  return logoutWithoutIdToken(env, request, parsed);
}

async function logoutWithIdToken(env: Env, request: LogoutRequest): Promise<Response> {
  let tokenClientId: string;
  let payload: Record<string, unknown>;
  try {
    const decoded = decodeJwt(request.idTokenHint as string);
    const decodedAudience = audience(decoded.aud);
    if (!decodedAudience)
      return oauthError("invalid_token", "id_token_hint is missing an audience");
    if (request.clientId && request.clientId !== decodedAudience) {
      return oauthError("invalid_request", "client_id does not match the ID token audience");
    }
    tokenClientId = decodedAudience;
    const { payload: verifiedPayload } = await compactVerify(
      request.idTokenHint as string,
      jwksFor(env),
    );
    payload = JSON.parse(new TextDecoder().decode(verifiedPayload)) as Record<string, unknown>;
  } catch {
    return oauthError("invalid_token", "id_token_hint could not be verified");
  }

  if (payload.iss !== trimTrailingSlash(env.APP_URL) || audience(payload.aud) !== tokenClientId) {
    return oauthError("invalid_token", "id_token_hint has invalid issuer or audience");
  }
  const client = await lookupLogoutClient(env, tokenClientId);
  if (client instanceof Response) return client;
  if (
    request.postLogoutRedirectUri &&
    !isRegisteredLogoutUri(client, request.postLogoutRedirectUri)
  ) {
    return oauthError(
      "invalid_request",
      "post_logout_redirect_uri is not registered for this client",
    );
  }

  const sessionId = payload.sid;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    return oauthError("invalid_token", "id_token_hint is missing a session identifier");
  }
  await env.DB.prepare("DELETE FROM session WHERE id = ?").bind(sessionId).run();
  return logoutResponse(request.postLogoutRedirectUri, request.state);
}

async function logoutWithoutIdToken(
  env: Env,
  httpRequest: Request,
  request: LogoutRequest,
): Promise<Response> {
  const client = request.clientId ? await lookupLogoutClient(env, request.clientId) : null;
  if (client instanceof Response) return client;
  if (request.postLogoutRedirectUri) {
    if (!client || !isRegisteredLogoutUri(client, request.postLogoutRedirectUri)) {
      return oauthError(
        "invalid_request",
        "post_logout_redirect_uri is not registered for this client",
      );
    }
  }

  // Without an ID-token hint, the specification requires user confirmation.
  if (!request.confirm) return confirmationPage(request);

  const signOut = await getAuth(env).api.signOut({
    headers: httpRequest.headers,
    asResponse: true,
  });
  const response = logoutResponse(request.postLogoutRedirectUri, request.state);
  for (const cookie of signOut.headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  return response;
}

async function parseLogoutRequest(request: Request): Promise<LogoutRequest | Response> {
  const url = new URL(request.url);
  let values: URLSearchParams;
  if (request.method === "GET") {
    values = url.searchParams;
  } else if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      return oauthError("invalid_request", "POST requests must use form serialization");
    }
    values = new URLSearchParams(await request.text());
  } else {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, POST" } });
  }
  return {
    clientId: values.get("client_id"),
    confirm: values.get("confirm") === "true",
    idTokenHint: values.get("id_token_hint"),
    postLogoutRedirectUri: values.get("post_logout_redirect_uri"),
    state: values.get("state"),
  };
}

async function lookupLogoutClient(env: Env, clientId: string): Promise<OAuthClientRow | Response> {
  const client = await env.DB.prepare(
    `SELECT clientId, disabled, enableEndSession, postLogoutRedirectUris
     FROM oauthClient WHERE clientId = ? LIMIT 1`,
  )
    .bind(clientId)
    .first<OAuthClientRow>();
  if (!client || isEnabled(client.disabled)) return oauthError("invalid_client", "unknown client");
  if (!isEnabled(client.enableEndSession)) {
    return oauthError("invalid_client", "client is not enabled for RP-Initiated Logout");
  }
  return client;
}

function confirmationPage(request: LogoutRequest): Response {
  const fields =
    hidden("client_id", request.clientId) +
    hidden("post_logout_redirect_uri", request.postLogoutRedirectUri) +
    hidden("state", request.state) +
    hidden("confirm", "true");
  return new Response(
    `<!doctype html><title>Confirm logout</title><main><h1>Sign out of GDG Japan Accounts?</h1><p>This will end your GDG Japan Accounts session.</p><form method="post">${fields}<button type="submit">Sign out</button></form><p><a href="/">Cancel</a></p></main>`,
    { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store" } },
  );
}

function hidden(name: string, value: string | null): string {
  return value === null ? "" : `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function logoutResponse(postLogoutRedirectUri: string | null, state: string | null): Response {
  if (!postLogoutRedirectUri)
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const redirect = new URL(postLogoutRedirectUri);
  if (state) redirect.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: redirect.toString(), "Cache-Control": "no-store" },
  });
}

function jwksFor(env: Env): ReturnType<typeof createRemoteJWKSet> {
  const issuer = trimTrailingSlash(env.APP_URL);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/api/auth/jwks`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

function audience(value: unknown): string | null {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

function isEnabled(value: number | boolean | null): boolean {
  return value === true || value === 1;
}

function isRegisteredLogoutUri(client: OAuthClientRow, uri: string): boolean {
  try {
    const parsed = JSON.parse(client.postLogoutRedirectUris ?? "[]");
    return Array.isArray(parsed) && parsed.includes(uri);
  } catch {
    return false;
  }
}

function oauthError(error: string, errorDescription: string): Response {
  return Response.json(
    { error, error_description: errorDescription },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ] as string,
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
