import { safeReturnTo } from "@gdgjp/gdg-lib/auth/return-to";
import { redirect } from "react-router";
import { getSessionUser } from "~/features/auth/auth.server";
import {
  createWorkspaceOauthState,
  workspaceAuthorizeUrl,
} from "~/features/google-workspace/google-workspace.server";
import type { Route } from "./+types/oauth.google-workspace.start";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  const user = await getSessionUser(env, request);
  if (!user) {
    const returnTo = url.pathname + url.search;
    throw redirect(`/signin?return_to=${encodeURIComponent(returnTo)}`);
  }

  const returnTo = safeReturnTo(url.searchParams.get("return_to"), url.origin) ?? "/dashboard";
  const { state, codeChallenge } = await createWorkspaceOauthState(env.DB, user.id, returnTo);
  return redirect(workspaceAuthorizeUrl(env, state, codeChallenge));
}
