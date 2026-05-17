import { safeReturnTo } from "~/lib/auth-redirect";
import { buildGoogleAuthorizeRedirect } from "~/lib/google.server";
import type { Route } from "./+types/oauth.google.start";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  // Sanitize: only same-origin paths and trusted *.gdgs.jp absolute URLs are
  // accepted. Without this, an attacker could craft
  // /oauth/google/start?return_to=https://evil.example and the callback's
  // post-sign-in 302 would deliver the victim to evil.example with a fresh
  // session cookie attached. safeReturnTo matches the signin.tsx contract.
  const returnTo = safeReturnTo(url.searchParams.get("return_to")) ?? "/dashboard";
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
