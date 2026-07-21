import { getAgentByName } from "agents";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth-utils.server";
import type { WikiGenerationAgent } from "../../workers/generation-agent";

const Body = z.object({
  answers: z.array(z.object({ id: z.string(), question: z.string(), answer: z.string() })).max(4),
});

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const sessionId = params.sessionId ?? "";
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const session = (await env.DB.prepare(
    "SELECT user_id, status FROM ingestion_sessions WHERE id = ?",
  )
    .bind(sessionId)
    .first()) as { user_id: string; status: string } | null;
  if (!session) return new Response("Not found", { status: 404 });
  if (session.user_id !== user.id) return new Response("Forbidden", { status: 403 });
  if (session.status !== "awaiting_clarification")
    return new Response("Session is not awaiting clarification", { status: 409 });
  const agent = await getAgentByName<Env, WikiGenerationAgent>(env.GENERATION_AGENT, sessionId);
  return Response.json(await agent.submitClarification(parsed.data));
}
