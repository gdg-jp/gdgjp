import type { ActionFunctionArgs } from "react-router";
import { createOrReplaceAnswerNote } from "~/features/agent-api/notes.server";
import { agentUnauthorized, resolveAgentWorkspace } from "~/features/agent-api/workspace.server";

/**
 * POST /api/agent/notes — create or replace a filed query answer under ns-answers.
 *
 * Authorization is a constant: the route can only write leaves under one hard-coded
 * parent with fixed visibility/type/origin. Callers never supply parent, page type,
 * visibility, or chapter — those are derived server-side from cited pages. That is
 * why ordinary chapter members (who lack canEdit on the namespace) may call it.
 */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env, ctx } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const body = await request.json().catch(() => null);
  const result = await createOrReplaceAnswerNote(env, ctx, resolved, body);
  if (!result.ok) {
    return Response.json(
      result.path ? { error: result.error, path: result.path } : { error: result.error },
      { status: result.status },
    );
  }
  return Response.json(result.body, { status: result.status });
}
