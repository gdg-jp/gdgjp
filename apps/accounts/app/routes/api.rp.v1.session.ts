import { handleRpSessionCheck } from "~/features/oauth/rp-session.server";
import type { Route } from "./+types/api.rp.v1.session";

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  return handleRpSessionCheck(context.cloudflare.env, request);
}
