import { createAuth } from "~/features/auth/auth.server";
import type { Route } from "./+types/dev.login";

export function loader({ request, context }: Route.LoaderArgs) {
  return createAuth(context.cloudflare.env).handleDevLogin(request);
}
