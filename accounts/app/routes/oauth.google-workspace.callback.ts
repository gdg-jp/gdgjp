import { redirect } from "react-router";
import { getSessionUser } from "~/lib/auth.server";
import {
  GOOGLE_WORKSPACE_SCOPES,
  consumeWorkspaceOauthState,
  exchangeWorkspaceCode,
  upsertWorkspaceConnection,
} from "~/lib/google-workspace.server";
import type { Route } from "./+types/oauth.google-workspace.callback";

const DEFAULT_RETURN_TO = "/dashboard";

/**
 * returnTo is either a relative path or one of safeReturnTo's trusted
 * absolute `https://*.gdgs.jp` sibling-app URLs (validated when the flow
 * started, or defaulted here). Preserve an absolute origin rather than
 * discarding it — otherwise a sibling app's "Connect Google Workspace" link
 * would silently land the user back on accounts.gdgs.jp instead of itself.
 */
function withWorkspaceStatus(returnTo: string, params: Record<string, string>): string {
  const isAbsolute = /^https:\/\//i.test(returnTo);
  const url = isAbsolute ? new URL(returnTo) : new URL(returnTo, "https://placeholder.invalid");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}`;
}

function errorRedirect(returnTo: string, reason: string): Response {
  return redirect(withWorkspaceStatus(returnTo, { workspace: "error", workspace_reason: reason }));
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);

  const user = await getSessionUser(env, request);
  if (!user) {
    const returnTo = url.pathname + url.search;
    throw redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  }

  const googleError = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (!state) throw errorRedirect(DEFAULT_RETURN_TO, "missing_state");

  const consumed = await consumeWorkspaceOauthState(env.DB, state, user.id);
  if (!consumed.ok) {
    // Reject replay, expiry, and cross-session presentation identically: none
    // of these should leak which case occurred to the caller.
    throw errorRedirect(DEFAULT_RETURN_TO, "state_invalid");
  }

  if (googleError) {
    const reason = googleError === "access_denied" ? "access_denied" : "google_error";
    throw errorRedirect(consumed.returnTo, reason);
  }
  if (!code) throw errorRedirect(consumed.returnTo, "missing_code");

  const exchange = await exchangeWorkspaceCode(env, code, consumed.codeVerifier);
  if (!exchange.ok) throw errorRedirect(consumed.returnTo, "exchange_failed");

  const missingScope = GOOGLE_WORKSPACE_SCOPES.some(
    (scope) => !exchange.grantedScopes.includes(scope),
  );
  if (missingScope) throw errorRedirect(consumed.returnTo, "scope_narrowed");

  // Google omits refresh_token on a repeat consent unless prompt=consent
  // forces a fresh one (it does here) — but never record a connection
  // without one; a token-less row would silently fail every later vend.
  if (!exchange.refreshToken) throw errorRedirect(consumed.returnTo, "missing_refresh_token");

  await upsertWorkspaceConnection(
    env,
    env.DB,
    user.id,
    exchange.refreshToken,
    exchange.grantedScopes.join(" "),
  );

  return redirect(withWorkspaceStatus(consumed.returnTo, { workspace: "connected" }));
}
