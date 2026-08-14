import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import { getGoogleOAuthToken, upsertGoogleOAuthToken } from "~/lib/db.server";

// drive.file (non-sensitive) lets the connected admin's app-created files and
// anything they explicitly grant via Picker be read/written without Google's
// restricted-scope verification. spreadsheets is required to write claim values.
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export class GoogleNotConnectedError extends Error {
  constructor(message = "このイベントはGoogleアカウントが連携されていません") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleFolderNotConfiguredError extends Error {
  constructor(message = "このイベントのGoogle Driveフォルダが設定されていません") {
    super(message);
    this.name = "GoogleFolderNotConfiguredError";
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function randomVerifier(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

function googleRedirectUri(appUrl: string): string {
  return `${appUrl}/google/callback`;
}

export async function googleAuthorizationUrl(
  env: Pick<Env, "APP_URL" | "GOOGLE_OAUTH_CLIENT_ID">,
  state: string,
  verifier: string,
): Promise<string> {
  const challenge = await codeChallenge(verifier);
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: googleRedirectUri(env.APP_URL),
    scope: GOOGLE_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

type GoogleUserinfoResponse = { email?: string };

export async function exchangeGoogleCode(
  env: Pick<Env, "APP_URL" | "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET">,
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; email: string }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: googleRedirectUri(env.APP_URL),
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Google token exchange failed (${response.status}): ${body}`);
    throw new Error(`Google token exchange failed (${response.status}): ${body}`);
  }
  const token = await response.json<GoogleTokenResponse>();
  if (!token.refresh_token) {
    throw new Error(
      "Googleからリフレッシュトークンが返却されませんでした。もう一度連携してください",
    );
  }
  const me = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!me.ok) {
    const body = await me.text();
    console.error(`Google userinfo request failed (${me.status}): ${body}`);
    throw new Error("Googleアカウントのメールアドレスを取得できませんでした");
  }
  const meJson = await me.json<GoogleUserinfoResponse>();
  if (!meJson.email) throw new Error("Googleアカウントのメールアドレスを取得できませんでした");
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    email: meJson.email,
  };
}

export async function getValidGoogleAccessToken(env: Env, userId: string): Promise<string> {
  const record = await getGoogleOAuthToken(env.DB, userId);
  if (!record) throw new GoogleNotConnectedError();

  const current = await decryptSecret(env.TOKEN_ENCRYPTION_KEY, record.accessTokenEnc);
  if (record.accessTokenExpiresAt * 1000 > Date.now() + 60_000) return current;

  const refreshToken = await decryptSecret(env.TOKEN_ENCRYPTION_KEY, record.refreshTokenEnc);
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  });
  if (!response.ok) {
    throw new GoogleNotConnectedError("Googleとの連携が失効しました。再度連携してください");
  }
  const token = await response.json<GoogleTokenResponse>();
  const accessTokenExpiresAt = Math.floor(Date.now() / 1000) + token.expires_in;
  await upsertGoogleOAuthToken(env.DB, {
    userId,
    googleEmail: record.googleEmail,
    accessTokenEnc: await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.access_token),
    refreshTokenEnc: token.refresh_token
      ? await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.refresh_token)
      : record.refreshTokenEnc,
    accessTokenExpiresAt,
  });
  return token.access_token;
}

export async function googleFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(url, { ...init, headers });
}
