import type { ActionFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { setHideAgentPages } from "~/features/spaces/viewer.server";

/** POST hideAgentPages=true|false — display preference for agent-written pages. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const form = await request.formData();
  const value = form.get("hideAgentPages");
  if (value !== "true" && value !== "false") {
    return Response.json({ error: "invalid_value" }, { status: 400 });
  }
  await setHideAgentPages(env, user.id, value === "true");
  return Response.json({ ok: true, hideAgentPages: value === "true" });
}
