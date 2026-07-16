import { safeReturnTo } from "~/lib/auth-redirect";
import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/oauth.google.start";

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const callbackURL = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
  const oauthQuery = url.searchParams.get("oauth_query") ?? undefined;
  // oauth-provider's pre-login middleware consumes this signed continuation
  // value before Better Auth validates the core social-sign-in body.
  const body = { provider: "google" as const, callbackURL, oauth_query: oauthQuery };
  return getAuth(context.cloudflare.env).api.signInSocial({
    headers: request.headers,
    body,
    asResponse: true,
  });
}
