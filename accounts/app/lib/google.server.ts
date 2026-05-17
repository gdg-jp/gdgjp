// Google upstream sign-in via openid-client (replaces better-auth's social provider).
// Flow:
//   /oauth/google/start  → build Google authorize URL with PKCE + signed state cookie
//   /oauth/google/callback → exchange code, fetch userinfo, return { sub, email, name, picture, emailVerified }

import {
  clearedCookie,
  parseCookies,
  serializeCookie,
  signPayload,
  verifyPayload,
} from "@gdgjp/gdg-lib";
import * as oidc from "openid-client";

const GOOGLE_ISSUER = "https://accounts.google.com";
const TX_COOKIE = "gdgjp-google-oidc-tx";
const TX_MAX_AGE_S = 60 * 10;

interface TxPayload {
  codeVerifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  exp: number;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  emailVerified: boolean;
}

let configCache: { p: Promise<oidc.Configuration>; key: string } | null = null;

function getGoogleConfig(clientId: string, clientSecret: string): Promise<oidc.Configuration> {
  const key = clientId;
  if (configCache?.key === key) return configCache.p;
  const p = oidc.discovery(new URL(GOOGLE_ISSUER), clientId, clientSecret).catch((err) => {
    configCache = null;
    throw err;
  });
  configCache = { p, key };
  return p;
}

export async function buildGoogleAuthorizeRedirect(args: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  returnTo: string;
  secret: string;
  isLocal: boolean;
}): Promise<Response> {
  const config = await getGoogleConfig(args.clientId, args.clientSecret);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const authUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: args.redirectUri,
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });

  const tx: TxPayload = {
    codeVerifier,
    state,
    nonce,
    returnTo: args.returnTo,
    exp: Date.now() + TX_MAX_AGE_S * 1000,
  };
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": serializeCookie({
        name: TX_COOKIE,
        value: await signPayload(tx, args.secret),
        maxAge: TX_MAX_AGE_S,
        secure: !args.isLocal,
      }),
    },
  });
}

export interface GoogleCallbackResult {
  user: GoogleUserInfo;
  returnTo: string;
  clearTxCookie: string;
}

export async function handleGoogleCallback(args: {
  request: Request;
  clientId: string;
  clientSecret: string;
  secret: string;
}): Promise<GoogleCallbackResult> {
  const txValue = parseCookies(args.request.headers.get("cookie"))[TX_COOKIE];
  if (!txValue) throw new Error("Missing Google OIDC transaction cookie");
  const tx = await verifyPayload<TxPayload>(txValue, args.secret);
  if (!tx || tx.exp < Date.now()) throw new Error("Invalid or expired Google OIDC transaction");

  const config = await getGoogleConfig(args.clientId, args.clientSecret);
  const tokens = await oidc.authorizationCodeGrant(config, new URL(args.request.url), {
    pkceCodeVerifier: tx.codeVerifier,
    expectedState: tx.state,
    expectedNonce: tx.nonce,
    idTokenExpected: true,
  });

  const claims = tokens.claims();
  if (!claims?.sub || typeof claims.sub !== "string") {
    throw new Error("Google id_token missing sub claim");
  }

  const user: GoogleUserInfo = {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    name:
      typeof claims.name === "string"
        ? claims.name
        : typeof claims.email === "string"
          ? claims.email
          : "",
    picture: typeof claims.picture === "string" ? claims.picture : null,
    emailVerified: claims.email_verified === true,
  };

  return { user, returnTo: tx.returnTo, clearTxCookie: clearedCookie(TX_COOKIE) };
}
