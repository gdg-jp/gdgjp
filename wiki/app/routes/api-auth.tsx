import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/lib/auth.server";

/**
 * Catch-all route that forwards all /api/auth/* requests to better-auth.
 * Handles Google OAuth redirect, callback, session refresh, sign-out, etc.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const auth = createAuth(context.cloudflare.env);
  return auth.handler(request);
}

export async function action({ request, context }: ActionFunctionArgs) {
  const auth = createAuth(context.cloudflare.env);
  return auth.handler(request);
}
