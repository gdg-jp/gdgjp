import type { LoaderFunctionArgs } from "react-router";
import {
  agentUnauthorized,
  mapWorkspaceError,
  parseOptionalPositiveInt,
  resolveAgentWorkspace,
  workspaceDataResponse,
} from "~/lib/agent-workspace.server";

/** GET /api/agent/cat — read a workspace page for the Bearer token's actor. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (!path) return Response.json({ error: "path_required" }, { status: 400 });

  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const maxChars = parseOptionalPositiveInt(url.searchParams.get("maxChars"));
    const result = await resolved.workspace.cat(path, {
      ...(maxChars !== undefined ? { maxChars } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return workspaceDataResponse(result);
  } catch (error) {
    return mapWorkspaceError(error);
  }
}
