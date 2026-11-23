import type { LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/features/auth/auth.server";

export function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env;
  return createAuth(env).handleSignOutRedirect(request);
}
