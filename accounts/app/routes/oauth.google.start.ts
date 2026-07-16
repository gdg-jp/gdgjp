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
  const response = await getAuth(context.cloudflare.env).api.signInSocial({
    headers: request.headers,
    body,
    asResponse: true,
  });
  return redirectSocialResponse(response);
}

export function redirectSocialResponse(response: Response): Response {
  const location = response.headers.get("Location");
  if (!location) return response;

  // Better Auth's server API serializes the redirect target as a 200 JSON
  // response. Turn it into a browser redirect while preserving the signed
  // OAuth state cookie emitted by Better Auth.
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Type");
  return new Response(null, { status: 302, headers });
}
