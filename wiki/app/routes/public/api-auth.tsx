import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/lib/auth.server";

/**
 * Catch-all route forwarding /api/auth/* to the openid-client RP factory.
 * Handles /api/auth/signin, /api/auth/callback/gdgjp, /api/auth/signout, /api/auth/me.
 */
export function loader({ request, context }: LoaderFunctionArgs) {
  return createAuth(context.cloudflare.env).handleAuthRequest(request);
}

export function action({ request, context }: ActionFunctionArgs) {
  return createAuth(context.cloudflare.env).handleAuthRequest(request);
}
