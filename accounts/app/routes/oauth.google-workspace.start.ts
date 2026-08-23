import { redirect } from "react-router";
import { safeReturnTo } from "~/lib/auth-redirect";
import { getSessionUser } from "~/lib/auth.server";
import { createWorkspaceOauthState, workspaceAuthorizeUrl } from "~/lib/google-workspace.server";
import type { Route } from "./+types/oauth.google-workspace.start";

/**
 * Starts the additive Google Workspace consent (incremental authorization on
 * the same GCP client used for login) — separate from Better Auth's
 * signInSocial-based /oauth/google/start, which only ever grants login scopes.
 * Requires an existing accounts.gdgs.jp session: this is an action on an
 * already-signed-in account, not a sign-in path.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  const user = await getSessionUser(env, request);
  if (!user) {
    const returnTo = url.pathname + url.search;
    throw redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  }

  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
  const { state, codeChallenge } = await createWorkspaceOauthState(env.DB, user.id, returnTo);
  return redirect(workspaceAuthorizeUrl(env, state, codeChallenge));
}
