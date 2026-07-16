import type { LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/lib/auth.server";

/** GET /logout — OIDC RP-Initiated Logout. */
export function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  return createAuth(env).handleSignOutRedirect(request, { returnTo: "/login" });
}
