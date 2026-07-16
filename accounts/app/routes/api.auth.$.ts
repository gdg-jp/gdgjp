import { getAuth } from "~/lib/auth.server";
import { handleDeveloperOAuthApi } from "~/lib/developer-oauth-api.server";
import type { Route } from "./+types/api.auth.$";

export async function loader({ request, context }: Route.LoaderArgs) {
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
