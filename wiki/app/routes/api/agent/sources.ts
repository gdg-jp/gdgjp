import type { ActionFunctionArgs } from "react-router";
import { agentUnauthorized, resolveAgentWorkspace } from "~/lib/agent-workspace.server";
import { createSource } from "~/lib/sources.server";

/** POST /api/agent/sources — register a source as the Bearer token's user. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const body = (await request.json().catch(() => null)) as {
    url?: unknown;
    visibility?: unknown;
    chapter?: unknown;
    refreshPolicy?: unknown;
  } | null;

  const result = await createSource(env, {
    url: body?.url,
    visibility: body?.visibility,
    chapter: body?.chapter,
    refreshPolicy: body?.refreshPolicy,
    user: resolved.identity.user,
    chapters: resolved.identity.chapters,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result.source, { status: 201 });
}
