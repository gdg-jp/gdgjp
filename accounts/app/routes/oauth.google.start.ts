import { buildGoogleAuthorizeRedirect } from "~/lib/google.server";
import type { Route } from "./+types/oauth.google.start";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return_to") ?? "/dashboard";
  return buildGoogleAuthorizeRedirect({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${trimTrailing(env.APP_URL)}/oauth/google/callback`,
    returnTo,
    secret: env.IDP_SESSION_SECRET,
    isLocal: env.APP_URL.startsWith("http://localhost"),
  });
}

function trimTrailing(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
