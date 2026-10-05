import * as oidc from "openid-client";

import { loginFailure, renderHome } from "../pages/demo";
import { clearCookie, encryptedCookie, readEncryptedCookie } from "../platform/cookies";
import { redirect } from "../platform/http";
import type { Env } from "./config";
import { isConfigured } from "./config";
import type { Session } from "./session";
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from "./session";

type Transaction = {
  codeVerifier: string;
  exp: number;
  nonce: string;
  state: string;
};

const TRANSACTION_COOKIE = "gdgjp-oidc-demo-transaction";
const TRANSACTION_MAX_AGE_S = 60 * 10;
const REQUESTED_SCOPE = "openid email profile https://gdgs.jp/scopes/chapters";
const issuerCache = new Map<string, Promise<oidc.Configuration>>();

export async function startLogin(request: Request, env: Env): Promise<Response> {
  if (!isConfigured(env)) return renderHome(request, false, null, 503);

  const issuer = await getIssuer(env);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const callback = callbackUrl(request);
  const authorizationUrl = oidc.buildAuthorizationUrl(issuer, {
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
    redirect_uri: callback,
    scope: REQUESTED_SCOPE,
    state,
  });
  const transaction: Transaction = {
    codeVerifier,
    exp: Date.now() + TRANSACTION_MAX_AGE_S * 1000,
    nonce,
    state,
  };
  return redirect(authorizationUrl.toString(), {
    "Set-Cookie": await encryptedCookie(
      TRANSACTION_COOKIE,
      transaction,
      env.SESSION_SECRET as string,
      TRANSACTION_MAX_AGE_S,
      request,
    ),
  });
}

export async function finishLogin(request: Request, env: Env): Promise<Response> {
  const clearTransaction = clearCookie(TRANSACTION_COOKIE, request);
  if (!isConfigured(env))
    return loginFailure("OIDC client is not configured.", clearTransaction, 503);
  const callback = new URL(request.url);
  if (callback.searchParams.has("error")) {
    return loginFailure("GDG Accounts did not complete sign-in.", clearTransaction);
  }
  const transaction = await readEncryptedCookie<Transaction>(
    request,
    TRANSACTION_COOKIE,
    env.SESSION_SECRET as string,
  );
  if (!isTransaction(transaction)) {
    return loginFailure("The sign-in request is missing, invalid, or expired.", clearTransaction);
  }

  try {
    const issuer = await getIssuer(env);
    const tokens = await oidc.authorizationCodeGrant(issuer, callback, {
      expectedNonce: transaction.nonce,
      expectedState: transaction.state,
      idTokenExpected: true,
      pkceCodeVerifier: transaction.codeVerifier,
    });
    const idTokenClaims = tokens.claims();
    const sub = idTokenClaims?.sub;
    if (!tokens.id_token || typeof sub !== "string" || sub.length === 0) {
      return loginFailure("GDG Accounts returned an invalid identity token.", clearTransaction);
    }
    const claims = await oidc.fetchUserInfo(issuer, tokens.access_token, sub);
    const issuerName = issuer.serverMetadata().issuer;
    if (typeof issuerName !== "string" || issuerName !== env.IDP_ISSUER) {
      return loginFailure("GDG Accounts returned an unexpected issuer.", clearTransaction);
    }
    const session: Session = {
      claims: claims as Record<string, unknown>,
      exp: Date.now() + SESSION_MAX_AGE_S * 1000,
      idToken: tokens.id_token,
      issuer: issuerName,
      sub,
    };
    const headers = new Headers({ Location: new URL(request.url).origin });
    headers.append("Set-Cookie", clearTransaction);
    headers.append(
      "Set-Cookie",
      await encryptedCookie(
        SESSION_COOKIE,
        session,
        env.SESSION_SECRET as string,
        SESSION_MAX_AGE_S,
        request,
      ),
    );
    return new Response(null, { headers, status: 302 });
  } catch {
    return loginFailure("GDG Accounts could not verify this sign-in.", clearTransaction);
  }
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const returnTo = `${new URL(request.url).origin}/`;
  return redirect(returnTo, { "Set-Cookie": clearCookie(SESSION_COOKIE, request) });
}

async function getIssuer(env: Env): Promise<oidc.Configuration> {
  const key = `${env.IDP_ISSUER}|${env.IDP_CLIENT_ID}|${env.IDP_CLIENT_SECRET}`;
  let cached = issuerCache.get(key);
  if (!cached) {
    cached = oidc
      .discovery(
        new URL(env.IDP_ISSUER),
        env.IDP_CLIENT_ID as string,
        env.IDP_CLIENT_SECRET as string,
        undefined,
        {
          timeout: 10,
        },
      )
      .catch((error) => {
        issuerCache.delete(key);
        throw error;
      });
    issuerCache.set(key, cached);
  }
  return cached;
}

function isTransaction(value: Transaction | null): value is Transaction {
  return Boolean(
    value &&
      typeof value.codeVerifier === "string" &&
      typeof value.nonce === "string" &&
      typeof value.state === "string" &&
      typeof value.exp === "number" &&
      value.exp > Date.now(),
  );
}

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/auth/callback`;
}
