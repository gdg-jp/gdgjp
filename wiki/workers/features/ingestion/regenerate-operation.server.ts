import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type { ChangesetOperation } from "../../../shared/ingestion/domain";
import { regenerateOperationWithModel } from "./model/regenerate-operation";
import type { GenerationObservability, GenerationTraceContext } from "./observability";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { D1IngestionSessionRepository } from "./persistence/d1/ingestion-session-repository";
import { createD1WikiWorkspaceStore } from "./persistence/d1/wiki-read-repository";
import { createR2ManifestWorkspaceAdapter } from "./persistence/r2/manifest-workspace-adapter";
import { loadIngestionAttachmentParts } from "./tools/attachments";
import { WikiWorkspaceAdapter } from "./tools/workspace/wiki-adapter";
import { createMountedWorkspace } from "./tools/workspace/workspace";

export async function regenerateDraftOperation(
  env: Env,
  sessionId: string,
  userId: string,
  params: { operationIndex: number; feedback?: string },
  events: ExecutionEventSink = noopExecutionEventSink,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): Promise<ChangesetOperation> {
  const sessions = new D1IngestionSessionRepository(env.DB);
  const session = await sessions.findOwned(sessionId, userId);
  if (!session || session.status !== "done" || !session.draft) {
    throw new Error("Draft is not available");
  }
  if (session.draft.phase && session.draft.phase !== "result") {
    throw new Error("Draft is not available");
  }
  const operation = session.draft.operations[params.operationIndex];
  if (!operation) throw new Error("Operation not found");
  const actor = {
    userId,
    email: session.accessContext?.email ?? "",
    isAdmin: session.accessContext?.isAdmin ?? false,
    chapterIds: session.accessContext?.chapterIds ?? [],
  };
  const sourceNodes = session.contextManifest.sourceNodes ?? [];
  const workspace = createMountedWorkspace({
    wiki: new WikiWorkspaceAdapter(createD1WikiWorkspaceStore(drizzle(env.DB, { schema }), actor)),
    googleDocs: createR2ManifestWorkspaceAdapter(env.BUCKET, "/google-docs", sourceNodes),
    websites: createR2ManifestWorkspaceAdapter(env.BUCKET, "/websites", sourceNodes),
    additionalMounts: [
      {
        mount: "/google-forms",
        adapter: createR2ManifestWorkspaceAdapter(env.BUCKET, "/google-forms", sourceNodes),
      },
    ],
  });
  const evidenceChunks = await Promise.all(
    (operation.evidencePaths ?? []).map(async (path) => {
      const result = await workspace.cat(path, { maxChars: 24_000 });
      return `## ${path}\n${result.data.content}`;
    }),
  );
  const attachments = await loadIngestionAttachmentParts(env.BUCKET, session.inputs);
  const directInput = [
    session.inputs.texts.join("\n\n"),
    session.draft.clarificationAnswers
      ? `確認回答:\n${session.draft.clarificationAnswers}`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const replacement = await regenerateOperationWithModel(
    env,
    operation,
    directInput,
    evidenceChunks.join("\n\n"),
    attachments,
    params.feedback,
    events,
    params.operationIndex,
    observability,
    trace,
  );
  await sessions.replaceOperation(sessionId, params.operationIndex, replacement);
  return replacement;
}
