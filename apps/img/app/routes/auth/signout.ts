import { getAuth } from "~/features/auth/auth.server";
import type { Route } from "./+types/signout";

export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handleSignOutRedirect(request);
}
