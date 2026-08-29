import type { LoaderFunctionArgs } from "react-router";
import { agentUnauthorized, resolveAgentWorkspace } from "~/lib/agent-workspace.server";
import { extractInstructionSections, getAgentInstructions } from "~/lib/agents-md.server";
import { getDb } from "~/lib/db.server";

const QUERY_HEADINGS = ["## Sensitive information", "### Citations"] as const;

/**
 * GET /api/agent/instructions?profile=query — AGENTS.md slice for the filing pass.
 * Fail closed: missing headings → 503 so filing skips rather than writing without rules.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const url = new URL(request.url);
  const profile = url.searchParams.get("profile");
  if (profile !== "query") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }

  const agents = await getAgentInstructions(getDb(env));
  if (!agents) {
    return Response.json({ error: "instructions_unavailable" }, { status: 503 });
  }

  const content = extractInstructionSections(agents.content, QUERY_HEADINGS);
  if (!content) {
    return Response.json({ error: "instructions_unavailable" }, { status: 503 });
  }

  return Response.json({
    profile: "query",
    content,
    contentHash: agents.contentHash,
  });
}
