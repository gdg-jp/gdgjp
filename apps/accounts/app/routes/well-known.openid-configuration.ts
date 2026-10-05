import { runAuthHandler } from "~/features/auth/auth.server";
import type { Route } from "./+types/well-known.openid-configuration";

export function loader({ request, context }: Route.LoaderArgs) {
  return runAuthHandler(context.cloudflare.env, request);
}
