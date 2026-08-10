import { getAuth, runAuthHandler } from "~/lib/auth.server";
import { handleDeveloperOAuthApi } from "~/lib/developer-oauth-api.server";
import { handleVerifiedEndSession } from "~/lib/legacy-end-session.server";
import type { Route } from "./+types/api.auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  if (new URL(request.url).pathname === "/api/auth/oauth2/end-session") {
    const auth = getAuth(context.cloudflare.env);
    const providerResponse = await runAuthHandler(context.cloudflare.env, request);
    if (providerResponse.status === 500) {
      const recoveryResponse = await handleVerifiedEndSession(
        context.cloudflare.env.DB,
        request,
        context.cloudflare.env.APP_URL,
        auth.api,
        (headers) => auth.api.signOut({ headers, asResponse: true }),
      );
      if (recoveryResponse) {
        console.warn("Recovered an OIDC end-session provider failure with local JWKS verification");
        return recoveryResponse;
      }
    }
    return providerResponse;
  }
  const developerResponse = await handleDeveloperOAuthApi(context.cloudflare.env, request);
  if (developerResponse) return developerResponse;
  return runAuthHandler(context.cloudflare.env, request);
}

export async function action({ request, context }: Route.ActionArgs) {
  if (new URL(request.url).pathname === "/api/auth/admin/oauth2/update-client") {
    return new Response("Not Found", { status: 404 });
  }
  const developerResponse = await handleDeveloperOAuthApi(context.cloudflare.env, request);
  if (developerResponse) return developerResponse;
  return runAuthHandler(context.cloudflare.env, request);
}
