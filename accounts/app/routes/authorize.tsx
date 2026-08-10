import { buildSignInRedirect } from "~/lib/auth-redirect";
import { runAuthHandler } from "~/lib/auth.server";
import type { Route } from "./+types/authorize";

export function loader({ request, context }: Route.LoaderArgs) {
  return runAuthHandler(
    context.cloudflare.env,
    rewrite(request, "/api/auth/oauth2/authorize"),
    () => buildSignInRedirect(request),
  );
}

function rewrite(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

export default function AuthorizeRoute() {
  return null;
}
