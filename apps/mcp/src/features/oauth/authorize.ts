import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
} from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../env";
import { UpstreamGrantError, exchangeCode, fetchUser, upstreamAuthorizeUrl } from "./accounts";
import { consentPage, errorPage, htmlPage } from "./consent-page";
import { approvedScopes } from "./scopes";
import { type AuthProps, authorizationServer } from "./server";

type Deps = { fetch?: typeof fetch };
type UpstreamData = { codeVerifier: string };

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function redirect(location: string, headers = new Headers()): Response {
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = authorizationServer(env).getOAuthApi(env);
  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      return htmlPage(
        `${details.clientName} を許可しますか？`,
        consentPage(details, consent.handle),
        200,
        consent.headers,
      );
    }
    if (request.method !== "POST") return new Response(null, { status: 405 });

    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, {
      scope: approvedScopes(form.getAll("scope").map(String)),
    });
    const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const codeChallenge = base64Url(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
    );
    const { state, headers } = await oauth.beginUpstream(approved.request, {
      data: { codeVerifier } satisfies UpstreamData,
      headers: approved.headers,
    });
    return redirect(upstreamAuthorizeUrl(env, { state, codeChallenge }), headers);
  } catch (error) {
    return authorizationFailure(error);
  }
}

export async function handleCallback(
  request: Request,
  env: Env,
  deps: Deps = {},
): Promise<Response> {
  const oauth = authorizationServer(env).getOAuthApi(env);
  let resumed: Awaited<ReturnType<typeof oauth.finishUpstream<UpstreamData>>>;
  try {
    resumed = await oauth.finishUpstream<UpstreamData>(request);
  } catch (error) {
    return authorizationFailure(error);
  }
  const { request: original, data, headers } = resumed;
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (params.get("error") || !code) {
    return redirect(authorizationErrorRedirect(original, "access_denied"), headers);
  }

  let props: AuthProps;
  try {
    const upstream = await exchangeCode(
      env,
      { code, codeVerifier: data.codeVerifier },
      { fetch: deps.fetch },
    );
    const user = await fetchUser(env, upstream.accessToken, { fetch: deps.fetch });
    props = { userId: user.sub, email: user.email, name: user.name, upstream };
  } catch (error) {
    if (error instanceof UpstreamGrantError) {
      return errorPage("GDG Japan Accounts のサインインを完了できませんでした。");
    }
    return errorPage(
      "GDG Japan Accounts に接続できませんでした。時間をおいて試してください。",
      502,
    );
  }

  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: props.userId,
    metadata: {},
    scope: original.scope,
    props,
  });
  return redirect(redirectTo, headers);
}

function authorizationFailure(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    if (error.redirectTo) return redirect(error.redirectTo);
    return errorPage(error.description || "この接続リクエストは無効か、期限切れです。");
  }
  if (error instanceof CimdFetchError) {
    return errorPage("このアプリの登録情報を確認できませんでした。");
  }
  throw error;
}
