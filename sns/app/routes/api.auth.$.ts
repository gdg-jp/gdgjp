import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.auth.$";
export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handleAuthRequest(request);
}
export function action({ request, context }: Route.ActionArgs) {
  return getAuth(context.cloudflare.env).handleAuthRequest(request);
}
