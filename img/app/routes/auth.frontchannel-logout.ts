import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/auth.frontchannel-logout";

export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handleFrontchannelLogout(request);
}
