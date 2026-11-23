import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createAuth } from "~/features/auth/auth.server";

export function loader({ request, context }: LoaderFunctionArgs) {
  return createAuth(context.cloudflare.env).handleAuthRequest(request);
}

export function action({ request, context }: ActionFunctionArgs) {
  return createAuth(context.cloudflare.env).handleAuthRequest(request);
}
