import { base64UrlEncode, nowSeconds } from "../../lib";
import type { ChatPlatform, LinkStore, StoredLinkRecord } from "./links";
import {
  type TokenKeyring,
  decryptToken,
  encryptToken,
  parseTokenEncryptionKeys,
} from "./token-crypto";

/** Must match the seeded `agents` client redirect URI byte for byte. */
export const REDIRECT_URI = "https://agent.gdgs.jp/auth/callback";
export const STATE_TTL_SECONDS = 10 * 60;
const REFRESH_SKEW_SECONDS = 60;
/** `@gdgjp/gdg-lib/auth/claims` CHAPTERS_SCOPE; the agent Worker has no workspace deps. */
export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";
export const OAUTH_SCOPES = ["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE];

export type AuthEnv = {
  ACCOUNTS_URL: string;
  IDP_CLIENT_ID: string;
  IDP_CLIENT_SECRET: string;
  TOKEN_ENCRYPTION_KEYS: string;
};

export type AuthDeps = {
  env: AuthEnv;
  links: LinkStore;
  kv: Pick<KVNamespace, "get" | "put" | "delete">;
  fetch?: typeof fetch;
  keyring?: TokenKeyring;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};
class InvalidGrantError extends Error {}

const base = (env: AuthEnv) => env.ACCOUNTS_URL.replace(/\/$/, "");
const basic = (env: AuthEnv) => `Basic ${btoa(`${env.IDP_CLIENT_ID}:${env.IDP_CLIENT_SECRET}`)}`;
const keyring = (deps: AuthDeps) =>
  deps.keyring ?? parseTokenEncryptionKeys(deps.env.TOKEN_ENCRYPTION_KEYS);

async function tokenRequest(deps: AuthDeps, body: URLSearchParams): Promise<TokenResponse> {
  const response = await (deps.fetch ?? fetch)(`${base(deps.env)}/api/auth/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basic(deps.env),
    },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) {
    if (json.error === "invalid_grant") throw new InvalidGrantError();
    throw new Error("token_request_failed");
  }
  if (typeof json.access_token !== "string" || !json.access_token)
    throw new Error("token_request_failed");
  return json;
}

type LinkState = { platform: ChatPlatform; chatUserId: string; codeVerifier: string };

/** Start Authorization Code + PKCE for a verified chat identity; state lives in KV (single use). */
export async function createLinkUrl(
  platform: ChatPlatform,
  chatUserId: string,
  deps: AuthDeps,
): Promise<string> {
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64UrlEncode(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
  );
  await deps.kv.put(
    `link:state:${state}`,
    JSON.stringify({ platform, chatUserId, codeVerifier } satisfies LinkState),
    {
      expirationTtl: STATE_TTL_SECONDS,
    },
  );
  const url = new URL(`${base(deps.env)}/api/auth/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", deps.env.IDP_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** OAuth callback: the chat identity comes from the consumed state, never from the query. */
export async function completeLink(code: string, state: string, deps: AuthDeps): Promise<boolean> {
  if (!code || !state) return false;
  const key = `link:state:${state}`;
  const raw = await deps.kv.get(key);
  if (!raw) return false;
  await deps.kv.delete(key);
  const linkState = JSON.parse(raw) as LinkState;
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest(
      deps,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: linkState.codeVerifier,
      }),
    );
  } catch {
    return false;
  }
  if (!tokens.refresh_token) return false;
  const ring = keyring(deps);
  const now = nowSeconds();
  let subject: string | null = null;
  try {
    const info = await (deps.fetch ?? fetch)(`${base(deps.env)}/api/auth/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    subject = info.ok ? (((await info.json()) as { sub?: string }).sub ?? null) : null;
  } catch {
    subject = null;
  }
  await deps.links.write({
    platform: linkState.platform,
    chatUserId: linkState.chatUserId,
    accessToken: await encryptToken(tokens.access_token as string, ring),
    accessTokenExpiresAt: now + (tokens.expires_in ?? 3600),
    refreshToken: await encryptToken(tokens.refresh_token, ring),
    subject,
    linkedAt: now,
  });
  return true;
}

export type LinkedToken =
  | { status: "ok"; accessToken: string }
  | { status: "none" }
  | { status: "temporarily_unavailable" };

/** A usable access token for a linked chat user, refreshed (rotating, CAS) when near expiry. */
export async function getLinkedToken(
  platform: ChatPlatform,
  chatUserId: string,
  deps: AuthDeps,
): Promise<LinkedToken> {
  const stored = await deps.links.read(platform, chatUserId);
  if (!stored) return { status: "none" };
  const ring = keyring(deps);
  const now = nowSeconds();
  try {
    if (stored.record.accessTokenExpiresAt > now + REFRESH_SKEW_SECONDS) {
      return { status: "ok", accessToken: await decryptToken(stored.record.accessToken, ring) };
    }
    const refresh = await decryptToken(stored.record.refreshToken, ring);
    let tokens: TokenResponse;
    try {
      tokens = await tokenRequest(
        deps,
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
      );
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        // Someone else may have rotated it a moment ago; otherwise the link is dead.
        const current = await deps.links.read(platform, chatUserId);
        if (current && current.serialized !== stored.serialized)
          return getLinkedToken(platform, chatUserId, deps);
        await deps.links.compareAndDelete(platform, chatUserId, stored.serialized);
        return { status: "none" };
      }
      return { status: "temporarily_unavailable" };
    }
    const next: StoredLinkRecord = {
      ...stored.record,
      accessToken: await encryptToken(tokens.access_token as string, ring),
      accessTokenExpiresAt: now + (tokens.expires_in ?? 3600),
      refreshToken: await encryptToken(tokens.refresh_token ?? refresh, ring),
    };
    if (
      !(await deps.links.compareAndSet(
        platform,
        chatUserId,
        stored.serialized,
        JSON.stringify(next),
      ))
    ) {
      const winner = await deps.links.read(platform, chatUserId);
      if (winner && winner.record.accessTokenExpiresAt > now + REFRESH_SKEW_SECONDS) {
        return { status: "ok", accessToken: await decryptToken(winner.record.accessToken, ring) };
      }
      return { status: "temporarily_unavailable" };
    }
    return { status: "ok", accessToken: tokens.access_token as string };
  } catch {
    return { status: "temporarily_unavailable" };
  }
}

/** Revoke at the IdP, then delete exactly the record that supplied the token. */
export async function unlink(
  platform: ChatPlatform,
  chatUserId: string,
  deps: AuthDeps,
): Promise<boolean> {
  const stored = await deps.links.read(platform, chatUserId);
  if (!stored) return false;
  try {
    const refresh = await decryptToken(stored.record.refreshToken, keyring(deps));
    const response = await (deps.fetch ?? fetch)(`${base(deps.env)}/api/auth/oauth2/revoke`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basic(deps.env),
      },
      body: new URLSearchParams({ token: refresh, token_type_hint: "refresh_token" }),
    });
    if (!response.ok) return false;
    return deps.links.compareAndDelete(platform, chatUserId, stored.serialized);
  } catch {
    return false;
  }
}

export function callbackPage(ok: boolean): Response {
  const title = ok ? "Account linked" : "Linking failed";
  const message = ok
    ? "Your chat account is now linked to GDG Accounts. You can close this window."
    : "This linking link is invalid, expired, or already used.";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.5}</style></head><body><h1>${title}</h1><p>${message}</p></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
