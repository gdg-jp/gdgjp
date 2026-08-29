import type { ActionFunctionArgs } from "react-router";
import { agentUnauthorized, resolveAgentWorkspace } from "~/features/agent-api/workspace.server";
import { appendLogEntry } from "~/features/pages/wiki-catalog.server";

/** POST /api/agent/log — atomic append of a query log entry. */
export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  if (resolved.chapterIds.length === 0) {
    return Response.json({ error: "no_chapter_membership" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    lines?: unknown;
  } | null;

  if (!body || typeof body.subject !== "string" || !Array.isArray(body.lines)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body.lines.every((line) => typeof line === "string")) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const result = await appendLogEntry(env, {
    subject: body.subject,
    lines: body.lines,
    type: "query",
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return new Response(null, { status: 204 });
}
