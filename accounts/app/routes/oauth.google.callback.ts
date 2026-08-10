import { redirect } from "react-router";
import { runAuthHandler } from "~/lib/auth.server";
import type { Route } from "./+types/oauth.google.callback";

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  url.pathname = "/api/auth/callback/google";
  // Send the user back to a bare /signin rather than preserving this URL as
  // return_to: the authorization code in the query is single-use, so replaying
  // this callback after a successful sign-in would fail. Starting over is the
  // only recoverable state.
  return runAuthHandler(context.cloudflare.env, new Request(url, request), () =>
    redirect("/signin"),
  );
}
