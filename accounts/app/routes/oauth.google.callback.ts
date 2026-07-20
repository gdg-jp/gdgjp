import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/oauth.google.callback";

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  url.pathname = "/api/auth/callback/google";
  return getAuth(context.cloudflare.env).handler(new Request(url, request));
}
