import type { LinkAccountDeps, LinkAccountEnv } from "./contracts";
import { REDIRECT_URI } from "./settings";
export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type UserInfoResponse = {
  sub?: string;
};

export class InvalidGrantError extends Error {}

function accountsBase(env: LinkAccountEnv): string {
  return env.ACCOUNTS_URL.replace(/\/$/, "");
}

export function authorizeUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/authorize`;
}

export function tokenUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/token`;
}

export function userInfoUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/userinfo`;
}

export function revokeUrl(env: LinkAccountEnv): string {
  return `${accountsBase(env)}/api/auth/oauth2/revoke`;
}

export function basicAuthHeader(env: LinkAccountEnv): string {
  const credentials = Buffer.from(`${env.IDP_CLIENT_ID}:${env.IDP_CLIENT_SECRET}`, "utf8").toString(
    "base64",
  );
  return `Basic ${credentials}`;
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  deps: LinkAccountDeps,
): Promise<TokenResponse> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetchImpl(tokenUrl(deps.env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(deps.env),
    },
    body,
  });

  const json = (await response.json()) as TokenResponse;
  if (
    !response.ok ||
    typeof json.access_token !== "string" ||
    !json.access_token ||
    typeof json.refresh_token !== "string" ||
    !json.refresh_token
  ) {
    throw new Error("token_exchange_failed");
  }
  return json;
}

export async function refreshAccessToken(
  refreshToken: string,
  deps: LinkAccountDeps,
): Promise<TokenResponse> {
  const fetchImpl = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetchImpl(tokenUrl(deps.env), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(deps.env),
    },
    body,
  });

  let json: TokenResponse;
  try {
    json = (await response.json()) as TokenResponse;
  } catch {
    throw new Error("refresh_failed");
  }
  if (!response.ok) {
    if (json.error === "invalid_grant") throw new InvalidGrantError();
    throw new Error("refresh_failed");
  }
  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("refresh_failed");
  }
  if (
    json.refresh_token !== undefined &&
    (typeof json.refresh_token !== "string" || !json.refresh_token)
  ) {
    throw new Error("refresh_failed");
  }
  return json;
}

export async function fetchSubject(
  accessToken: string,
  deps: LinkAccountDeps,
): Promise<string | null> {
  const fetchImpl = deps.fetch ?? fetch;
  try {
    const response = await fetchImpl(userInfoUrl(deps.env), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as UserInfoResponse;
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}
