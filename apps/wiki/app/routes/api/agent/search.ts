import type { LoaderFunctionArgs } from "react-router";
import {
  agentUnauthorized,
  mapWorkspaceError,
  parseOptionalPositiveInt,
  resolveAgentWorkspace,
  workspaceDataResponse,
} from "~/features/agent-api/workspace.server";

/** GET /api/agent/search — D1 title/body search filtered by the caller's canView. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  if (q === null || !q.trim()) {
    return Response.json({ error: "query_required" }, { status: 400 });
  }

  const path = url.searchParams.get("path") ?? undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const limit = parseOptionalPositiveInt(url.searchParams.get("limit"));
    const result = await resolved.workspace.search(q, {
      ...(path !== undefined ? { path } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return workspaceDataResponse(result);
  } catch (error) {
    return mapWorkspaceError(error);
  }
}
