import {
  type DeveloperClient,
  DeveloperClientValidationError,
  createDeveloperClient,
  deleteDeveloperClient,
  getDeveloperClient,
  listDeveloperClients,
  rotateDeveloperClientSecret,
  updateDeveloperClient,
} from "./oauth-clients.server";

const MANAGEMENT_PATHS = new Set([
  "/api/auth/oauth2/create-client",
  "/api/auth/oauth2/get-client",
  "/api/auth/oauth2/get-clients",
  "/api/auth/oauth2/update-client",
  "/api/auth/oauth2/client/rotate-secret",
  "/api/auth/oauth2/delete-client",
]);

type OAuthClientBody = {
  client_id?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  redirect_uris?: unknown;
  post_logout_redirect_uris?: unknown;
  scope?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  type?: unknown;
  update?: unknown;
};

export async function handleDeveloperOAuthApi(
  env: Env,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!MANAGEMENT_PATHS.has(url.pathname)) return null;

  try {
    if (url.pathname === "/api/auth/oauth2/get-clients" && request.method === "GET") {
      return json((await listDeveloperClients(env, request)).map(toOAuthClient));
    }
    if (url.pathname === "/api/auth/oauth2/get-client" && request.method === "GET") {
      const clientId = url.searchParams.get("client_id");
      if (!clientId) return badRequest("client_id is required");
      return json(toOAuthClient(await getDeveloperClient(env, request, clientId)));
    }
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const body = (await request.json()) as OAuthClientBody;
    if (url.pathname === "/api/auth/oauth2/create-client") {
      assertFixedWebClient(body);
      const result = await createDeveloperClient(env, request, {
        name: requiredString(body.client_name, "client_name"),
        appUrl: optionalString(body.client_uri, "client_uri"),
        redirectUris: stringArray(body.redirect_uris, "redirect_uris"),
        postLogoutRedirectUris: optionalStringArray(
          body.post_logout_redirect_uris,
          "post_logout_redirect_uris",
        ),
        scopes: scopes(body.scope),
      });
      return secretJson({
        ...toOAuthClient(result.client),
        client_secret: result.clientSecret,
        client_secret_expires_at: 0,
      });
    }

    const clientId = requiredString(body.client_id, "client_id");
    if (url.pathname === "/api/auth/oauth2/update-client") {
      const current = await getDeveloperClient(env, request, clientId);
      const update = object(body.update, "update");
      assertFixedWebClient(update);
      const updated = await updateDeveloperClient(env, request, clientId, {
        name:
          update.client_name === undefined
            ? current.name
            : requiredString(update.client_name, "client_name"),
        appUrl:
          update.client_uri === undefined
            ? current.appUrl
            : optionalString(update.client_uri, "client_uri"),
        redirectUris:
          update.redirect_uris === undefined
            ? current.redirectUris
            : stringArray(update.redirect_uris, "redirect_uris"),
        postLogoutRedirectUris:
          update.post_logout_redirect_uris === undefined
            ? current.postLogoutRedirectUris
            : optionalStringArray(update.post_logout_redirect_uris, "post_logout_redirect_uris"),
        scopes: update.scope === undefined ? current.scopes : scopes(update.scope),
      });
      return json(toOAuthClient(updated));
    }
    if (url.pathname === "/api/auth/oauth2/client/rotate-secret") {
      const result = await rotateDeveloperClientSecret(env, request, clientId);
      return secretJson({
        ...toOAuthClient(result.client),
        client_secret: result.clientSecret,
        client_secret_expires_at: 0,
      });
    }
    if (url.pathname === "/api/auth/oauth2/delete-client") {
      await deleteDeveloperClient(env, request, clientId);
      return json({ success: true });
    }
    return new Response("Not Found", { status: 404 });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof DeveloperClientValidationError || error instanceof SyntaxError) {
      return badRequest(error.message);
    }
    throw error;
  }
}

function toOAuthClient(client: DeveloperClient) {
  return {
    client_id: client.clientId,
    client_name: client.name,
    client_uri: client.appUrl ?? undefined,
    redirect_uris: client.redirectUris,
    post_logout_redirect_uris: client.postLogoutRedirectUris,
    scope: client.scopes.join(" "),
    token_endpoint_auth_method: "client_secret_basic",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    public: false,
    type: "web",
    disabled: client.disabled,
    skip_consent: true,
    enable_end_session: true,
    require_pkce: true,
    subject_type: "public",
  };
}

function assertFixedWebClient(body: OAuthClientBody) {
  assertFixed(body.token_endpoint_auth_method, "client_secret_basic", "token_endpoint_auth_method");
  assertFixed(body.type, "web", "type");
  assertFixedArray(body.grant_types, ["authorization_code", "refresh_token"], "grant_types");
  assertFixedArray(body.response_types, ["code"], "response_types");
}

function assertFixed(value: unknown, expected: string, field: string) {
  if (value !== undefined && value !== expected)
    throw new DeveloperClientValidationError("invalid_scope", `${field} is fixed`);
}

function assertFixedArray(value: unknown, expected: string[], field: string) {
  if (value === undefined) return;
  const actual = stringArray(value, field);
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    throw new DeveloperClientValidationError("invalid_scope", `${field} is fixed`);
  }
}

function object(value: unknown, field: string): OAuthClientBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DeveloperClientValidationError("invalid_name", `${field} must be an object`);
  }
  return value as OAuthClientBody;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DeveloperClientValidationError("invalid_name", `${field} is required`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new DeveloperClientValidationError("invalid_app_url", `${field} must be a string`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DeveloperClientValidationError("invalid_redirect_uri", `${field} must be an array`);
  }
  return value as string[];
}

function optionalStringArray(value: unknown, field: string): string[] {
  return value === undefined || value === null ? [] : stringArray(value, field);
}

function scopes(value: unknown): string[] {
  if (value === undefined) return ["openid"];
  if (typeof value !== "string") {
    throw new DeveloperClientValidationError("invalid_scope", "scope must be a string");
  }
  return value.split(/\s+/).filter(Boolean);
}

function json(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

function secretJson(value: unknown) {
  return json(value, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

function badRequest(message: string) {
  return json({ error: "invalid_request", error_description: message }, { status: 400 });
}
