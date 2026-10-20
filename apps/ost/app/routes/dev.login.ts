import { getAuth } from "~/features/auth/auth.server";
import type { Route } from "./+types/dev.login";

/**
 * Local-dev / e2e sign-in shortcut without the Accounts round-trip:
 *
 *   /dev/login?as=owner&chapter=1:dev-chapter[:member]&admin=1&return_to=/
 *
 * Implemented once in gdg-lib for every relying party; it answers 404 unless
 * the app runs on a loopback URL, and its sessions are ignored elsewhere.
 */
export function loader({ request, context }: Route.LoaderArgs) {
  return getAuth(context.cloudflare.env).handleDevLogin(request);
}
