import type { ActionFunctionArgs } from "react-router";
import { createOrReplaceAnswerNote } from "~/features/agent-api/notes.server";
import { agentUnauthorized, resolveAgentWorkspace } from "~/features/agent-api/workspace.server";
import { developerAppWriteRefused, writesAllowed } from "~/features/agent-api/write-access.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();
  if (!writesAllowed(resolved.identity.client)) return developerAppWriteRefused();

  const body = await request.json().catch(() => null);
  const result = await createOrReplaceAnswerNote(env, resolved, body);
  if (!result.ok) {
    return Response.json(
      result.path ? { error: result.error, path: result.path } : { error: result.error },
      { status: result.status },
    );
  }
  return Response.json(result.body, { status: result.status });
}
