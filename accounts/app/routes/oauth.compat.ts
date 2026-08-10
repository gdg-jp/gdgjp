import { runAuthHandler } from "~/lib/auth.server";
import type { Route } from "./+types/oauth.compat";

export function action({ request, context }: Route.ActionArgs) {
  return runAuthHandler(context.cloudflare.env, rewrite(request));
}

function rewrite(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/api/auth/oauth2/token";
  return new Request(url, request);
}
