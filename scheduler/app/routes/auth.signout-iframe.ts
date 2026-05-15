import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.signout-iframe";

export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handleSignOutIframe(request);
}
