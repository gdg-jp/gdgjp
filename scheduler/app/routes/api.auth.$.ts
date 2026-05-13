import { getAuth } from "~/lib/auth.server";
import type { Route } from "./+types/api.auth.$";

export async function loader(args: Route.LoaderArgs) {
  return getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);
}

export async function action(args: Route.ActionArgs) {
  return getAuth(args.context.cloudflare.env).handleAuthRequest(args.request);
}
