import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/userinfo.compat";

export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handler(rewrite(request));
}

export function action({ request, context }: Route.ActionArgs) {
  return getAuth(context.cloudflare.env).handler(rewrite(request));
}

function rewrite(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/userinfo";
  return new Request(url, request);
}
