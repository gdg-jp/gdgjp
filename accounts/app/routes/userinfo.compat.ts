import { runAuthHandler } from "~/lib/auth.server";
import type { Route } from "./+types/userinfo.compat";

export function loader({ request, context }: Route.LoaderArgs) {
  return runAuthHandler(context.cloudflare.env, rewrite(request));
}

export function action({ request, context }: Route.ActionArgs) {
  return runAuthHandler(context.cloudflare.env, rewrite(request));
}

function rewrite(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/userinfo";
  return new Request(url, request);
}
