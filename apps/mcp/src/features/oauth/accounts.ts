import type { Env } from "../../env";

export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";
export const UPSTREAM_SCOPES = ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE];
export const EXPIRY_SKEW_SECONDS = 60;

export type UpstreamTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type AccountsUser = { sub: string; email: string; name: string };

export class UpstreamGrantError extends Error {}
export class UpstreamUnavailableError extends Error {}

type AccountsEnv = Pick<Env, "APP_URL" | "ACCOUNTS_URL" | "IDP_CLIENT_ID" | "IDP_CLIENT_SECRET">;
type Deps = { fetch?: typeof fetch; now?: () => number };

const trim = (url: string) => {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
};

export function upstreamRedirectUri(env: Pick<Env, "APP_URL">): string {
  return `${trim(env.APP_URL)}/callback`;
}

export function upstreamAuthorizeUrl(
  env: AccountsEnv,
  input: { state: string; codeChallenge: string },
): string {
  const url = new URL(`${trim(env.ACCOUNTS_URL)}/api/auth/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.IDP_CLIENT_ID);
  url.searchParams.set("redirect_uri", upstreamRedirectUri(env));
  url.searchParams.set("scope", UPSTREAM_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
};

async function tokenRequest(
  env: AccountsEnv,
  body: URLSearchParams,
  deps: Deps,
  previousRefreshToken?: string,
): Promise<UpstreamTokens> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${trim(env.ACCOUNTS_URL)}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${btoa(`${env.IDP_CLIENT_ID}:${env.IDP_CLIENT_SECRET}`)}`,
      },
      body,
    });
  } catch {
    throw new UpstreamUnavailableError("accounts_unreachable");
  }
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    if (json.error === "invalid_grant") throw new UpstreamGrantError("invalid_grant");
    throw new UpstreamUnavailableError(`token_request_failed_${response.status}`);
  }
  const refreshToken =
    typeof json.refresh_token === "string" && json.refresh_token
      ? json.refresh_token
      : previousRefreshToken;
  if (typeof json.access_token !== "string" || !json.access_token || !refreshToken) {
    throw new UpstreamUnavailableError("token_response_incomplete");
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  return { accessToken: json.access_token, refreshToken, expiresAt: now + expiresIn };
}

export function exchangeCode(
  env: AccountsEnv,
  input: { code: string; codeVerifier: string },
  deps: Deps = {},
): Promise<UpstreamTokens> {
  return tokenRequest(
    env,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: upstreamRedirectUri(env),
      code_verifier: input.codeVerifier,
    }),
    deps,
  );
}

export function refreshTokens(
  env: AccountsEnv,
  refreshToken: string,
  deps: Deps = {},
): Promise<UpstreamTokens> {
  return tokenRequest(
    env,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    deps,
    refreshToken,
  );
}

export async function fetchUser(
  env: Pick<Env, "ACCOUNTS_URL">,
  accessToken: string,
  deps: Deps = {},
): Promise<AccountsUser> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${trim(env.ACCOUNTS_URL)}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new UpstreamUnavailableError("accounts_unreachable");
  }
  if (!response.ok) throw new UpstreamUnavailableError(`userinfo_failed_${response.status}`);
  const info = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof info.sub !== "string" || !info.sub) {
    throw new UpstreamUnavailableError("userinfo_without_subject");
  }
  return {
    sub: info.sub,
    email: typeof info.email === "string" ? info.email : "",
    name: typeof info.name === "string" ? info.name : "",
  };
}

export function accessTokenTtl(tokens: UpstreamTokens, now = Math.floor(Date.now() / 1000)) {
  return Math.max(60, tokens.expiresAt - now - EXPIRY_SKEW_SECONDS);
}
