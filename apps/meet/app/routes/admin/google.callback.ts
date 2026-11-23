import { redirect } from "react-router";
import { requireAdmin } from "~/features/auth/access.server";
import { completeGoogleOauthCallback } from "~/features/google/oauth.server";
import { resetGoogleAccessTokenCache } from "~/features/google/token.server";
import type { Route } from "./+types/google.callback";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(env, request);
  const url = new URL(request.url);

  const result = await completeGoogleOauthCallback(env, user.id, {
    state: url.searchParams.get("state"),
    code: url.searchParams.get("code"),
    googleError: url.searchParams.get("error"),
  });

  if (!result.ok) {
    return redirect(`/admin/google?error=${encodeURIComponent(result.errorCode)}`);
  }

  resetGoogleAccessTokenCache();
  return redirect("/admin/google?status=connected");
}
