import { getAuth } from "~/lib/auth.server";
import { handleDeveloperOAuthApi } from "~/lib/developer-oauth-api.server";
import { handleLegacyEndSession, isMissingSessionError } from "~/lib/legacy-end-session.server";
import type { Route } from "./+types/api.auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
  if (new URL(request.url).pathname === "/api/auth/oauth2/end-session") {
    const auth = getAuth(context.cloudflare.env);
    const providerResponse = await auth.handler(request);
    if (await isMissingSessionError(providerResponse)) {
      const legacyResponse = await handleLegacyEndSession(
        context.cloudflare.env.DB,
        request,
        (headers) => auth.api.signOut({ headers, asResponse: true }),
      );
      if (legacyResponse) return legacyResponse;
    }
    return providerResponse;
  }
  const developerResponse = await handleDeveloperOAuthApi(context.cloudflare.env, request);
  if (developerResponse) return developerResponse;
  return getAuth(context.cloudflare.env).handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  if (new URL(request.url).pathname === "/api/auth/admin/oauth2/update-client") {
    return new Response("Not Found", { status: 404 });
  }
  const developerResponse = await handleDeveloperOAuthApi(context.cloudflare.env, request);
  if (developerResponse) return developerResponse;
  return getAuth(context.cloudflare.env).handler(request);
}
