import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import { getXAccount } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";

// X requires both tweet.read and users.read for GET /2/users/me. The latter
// identifies the account that just granted the posting authorization.
const X_SCOPES = "tweet.read tweet.write users.read offline.access media.write";

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

export function xAuthorizationUrl(env: Env, state: string, verifier: string): Promise<string> {
  return codeChallenge(verifier).then((challenge) => {
    const url = new URL(env.X_AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: env.X_CLIENT_ID,
      redirect_uri: `${env.APP_URL}/x/callback`,
      scope: X_SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  });
}

type XTokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };
type XMeResponse = {
  data?: { id: string; username: string; name: string; profile_image_url?: string };
  title?: string;
  detail?: string;
};

export async function exchangeXCode(
  env: Env,
  code: string,
  verifier: string,
): Promise<{ token: XTokenResponse; user: NonNullable<XMeResponse["data"]> }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.APP_URL}/x/callback`,
    client_id: env.X_CLIENT_ID,
    code_verifier: verifier,
  });
  const response = await fetch(env.X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
    },
    body,
  });
  if (!response.ok) throw new Error(`X token exchange failed (${response.status})`);
  const token = await response.json<XTokenResponse>();
  const me = await fetch(`${env.X_API_BASE_URL}/2/users/me?user.fields=profile_image_url`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const meJson = await me.json<XMeResponse>();
  if (!me.ok || !meJson.data) throw new Error(meJson.detail ?? "Unable to read X profile");
  return { token, user: meJson.data };
}

export async function accessTokenForAccount(env: Env, accountId: string): Promise<string> {
  const account = await getXAccount(env.DB, accountId);
  if (!account || account.revokedAt) throw new Error("X account is unavailable");
  const current = await decryptSecret(env.TOKEN_ENCRYPTION_KEY, account.accessTokenCiphertext);
  const expires = account.accessTokenExpiresAt
    ? Date.parse(account.accessTokenExpiresAt)
    : Number.POSITIVE_INFINITY;
  if (expires > Date.now() + 60_000) return current;
  if (!account.refreshTokenCiphertext)
    throw new Error("X authorization has expired; reconnect the account");
  const refresh = await decryptSecret(env.TOKEN_ENCRYPTION_KEY, account.refreshTokenCiphertext);
  const response = await fetch(env.X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: env.X_CLIENT_ID,
    }),
  });
  if (!response.ok) throw new Error("X authorization has expired; reconnect the account");
  const token = await response.json<XTokenResponse>();
  const now = new Date();
  await env.DB.prepare(
    "UPDATE x_accounts SET access_token_ciphertext = ?, refresh_token_ciphertext = ?, access_token_expires_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.access_token),
      token.refresh_token
        ? await encryptSecret(env.TOKEN_ENCRYPTION_KEY, token.refresh_token)
        : account.refreshTokenCiphertext,
      token.expires_in ? new Date(now.getTime() + token.expires_in * 1000).toISOString() : null,
      nowIso(),
      accountId,
    )
    .run();
  return token.access_token;
}

export async function resolveXUsername(
  env: Env,
  accountId: string,
  username: string,
): Promise<{ id: string; username: string }> {
  const token = await accessTokenForAccount(env, accountId);
  const response = await fetch(
    `${env.X_API_BASE_URL}/2/users/by/username/${encodeURIComponent(username.replace(/^@/, ""))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await response.json<{ data?: { id: string; username: string } }>();
  if (!response.ok || !json.data)
    throw new Error(`X user @${username.replace(/^@/, "")} was not found`);
  return json.data;
}
