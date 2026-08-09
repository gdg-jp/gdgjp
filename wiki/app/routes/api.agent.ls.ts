import type { LoaderFunctionArgs } from "react-router";
import {
  agentUnauthorized,
  mapWorkspaceError,
  parseOptionalPositiveInt,
  resolveAgentWorkspace,
  workspaceDataResponse,
} from "~/lib/agent-workspace.server";

/** GET /api/agent/ls — list a workspace directory for the Bearer token's actor. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const resolved = await resolveAgentWorkspace(request, env);
  if (!resolved) return agentUnauthorized();

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "/";
  const cursor = url.searchParams.get("cursor") ?? undefined;

  try {
    const limit = parseOptionalPositiveInt(url.searchParams.get("limit"));
    const result = await resolved.workspace.ls(path, {
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return workspaceDataResponse(result);
  } catch (error) {
    return mapWorkspaceError(error);
  }
}
