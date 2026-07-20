import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/well-known.oauth-authorization-server";

export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handler(request);
}
