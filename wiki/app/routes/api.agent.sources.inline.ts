import type { ActionFunctionArgs } from "react-router";
import { agentUnauthorized, resolveAgentWorkspace } from "~/lib/agent-workspace.server";
import { createInlineSource } from "~/lib/sources.server";

/** POST /api/agent/sources/inline — register an inline conversation log. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    content?: unknown;
    visibility?: unknown;
    chapter?: unknown;
    externalId?: unknown;
  } | null;

  const result = await createInlineSource(env, {
    title: body?.title,
    content: body?.content,
    visibility: body?.visibility,
    chapter: body?.chapter,
    externalId: body?.externalId,
    user: resolved.identity.user,
    chapters: resolved.identity.chapters,
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(
    {
      id: result.source.id,
      kind: result.source.kind,
      visibility: result.source.visibility,
      chapterId: result.source.chapterId,
      title: result.source.title,
      createdAt: (result.source.createdAt ?? new Date()).toISOString(),
    },
    { status: 201 },
  );
}
