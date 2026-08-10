import { runAuthHandler } from "~/lib/auth.server";
import type { Route } from "./+types/well-known.oauth-authorization-server";

export function loader({ request, context }: Route.LoaderArgs) {
  return runAuthHandler(context.cloudflare.env, request);
}
