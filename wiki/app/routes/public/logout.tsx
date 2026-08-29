import type { LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/features/auth/auth.server";

/** GET /logout — OIDC RP-Initiated Logout. */
export function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  return createAuth(env).handleSignOutRedirect(request);
}
