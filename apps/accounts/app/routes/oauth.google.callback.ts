import { redirect } from "react-router";
import { runAuthHandler } from "~/features/auth/auth.server";
import type { Route } from "./+types/oauth.google.callback";

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  url.pathname = "/api/auth/callback/google";
  return runAuthHandler(context.cloudflare.env, new Request(url, request), () =>
    redirect("/signin"),
  );
}
