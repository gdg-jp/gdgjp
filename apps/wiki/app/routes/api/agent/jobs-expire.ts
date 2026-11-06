import type { ActionFunctionArgs } from "react-router";
import { isAgentService } from "~/features/agent-api/agent-reader.server";
import { expireAnswer } from "~/features/jobs/answer.server";
import { getDb } from "~/lib/db.server";

/** POST /api/agent/jobs/:id/expire — the agent Worker sent the degraded reply. */
export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  if (!isAgentService(request, env)) return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json({ expired: await expireAnswer(env, getDb(env), params.id ?? "") });
}
