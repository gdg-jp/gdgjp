import type { BearerIdentity } from "@gdgjp/gdg-lib";
import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { getDb } from "~/lib/db.server";
import { createD1WikiWorkspaceStore } from "../../workers/features/ingestion/persistence/d1/wiki-read-repository";
import type { WorkspaceResult } from "../../workers/features/ingestion/tools/workspace/contracts";
import {
  WikiWorkspaceAdapter,
  type WorkspaceActor,
} from "../../workers/features/ingestion/tools/workspace/wiki-adapter";
import {
  type MountedWorkspace,
  createMountedWorkspace,
} from "../../workers/features/ingestion/tools/workspace/workspace";

export type AgentWorkspaceContext = {
  identity: BearerIdentity;
  workspace: MountedWorkspace;
  chapterIds: string[];
};

/**
 * Build a permission-scoped workspace for this request's Bearer token.
 * MountedWorkspace holds provenance traces and the store closes over one actor —
 * never reuse across requests.
 */
export async function resolveAgentWorkspace(
  request: Request,
  env: Env,
): Promise<AgentWorkspaceContext | null> {
  const identity = await getBearerIdentity(request, env.ACCOUNTS_URL);
  if (!identity) return null;
  const actor: WorkspaceActor = {
    userId: identity.user.id,
    email: identity.user.email,
    isAdmin: identity.user.isAdmin,
    chapterIds: identity.chapters.map((c) => String(c.chapterId)),
    chapters: identity.chapters.map((chapter) => ({
      chapterId: String(chapter.chapterId),
      role: chapter.role,
    })),
  };
  const store = createD1WikiWorkspaceStore(getDb(env), actor);
  const workspace = createMountedWorkspace({ wiki: new WikiWorkspaceAdapter(store) });
  return {
    identity,
    workspace,
    chapterIds: [...actor.chapterIds],
  };
}

export function agentUnauthorized(): Response {
  return Response.json({ error: "invalid_token" }, { status: 401 });
}

/**
 * Map workspace Error messages to stable HTTP codes without leaking internals.
 *
 * Restricted pages and missing pages share `not_found` — never 403. A 403 would
 * turn the API into an existence oracle for pages the caller cannot view.
 */
export function mapWorkspaceError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "Workspace path not found" ||
    message === "Workspace resource not found" ||
    message === "Workspace path is not mounted" ||
    message === "Workspace mount is unavailable"
  ) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (
    message === "Workspace cursor is outside resource" ||
    message === "Invalid workspace cursor"
  ) {
    return Response.json({ error: "invalid_cursor" }, { status: 400 });
  }
  if (
    message === "Workspace paths must be absolute POSIX paths" ||
    message === "Workspace path traversal is not allowed" ||
    message === "Workspace adapter paths must be relative" ||
    message === "Invalid workspace limit"
  ) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }
  if (message === "Workspace query must not be empty") {
    return Response.json({ error: "query_required" }, { status: 400 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}

/** Return adapter `data` plus `truncated`; omit provenance `manifest`. */
export function workspaceDataResponse<T extends object>(result: WorkspaceResult<T>): Response {
  return Response.json({ ...result.data, truncated: result.truncated });
}

export function parseOptionalPositiveInt(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("Invalid workspace limit");
  return value;
}
