import type { LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/lib/auth.server";

export function loader({ request, context }: LoaderFunctionArgs) {
  return createAuth(context.cloudflare.env).handleSignOutIframe(request);
}
