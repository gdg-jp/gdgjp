import { handleOidcEndSession } from "~/lib/oidc-end-session.server";
import type { Route } from "./+types/oauth2.end-session";

export function loader({ request, context }: Route.LoaderArgs) {
  return handleOidcEndSession(context.cloudflare.env, request);
}

export function action({ request, context }: Route.ActionArgs) {
  return handleOidcEndSession(context.cloudflare.env, request);
}
