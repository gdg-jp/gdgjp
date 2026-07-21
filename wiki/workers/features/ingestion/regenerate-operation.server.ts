import type { ChangesetOperation } from "../../../shared/ingestion/domain";
import { regenerateOperationWithModel } from "./model/regenerate-operation";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { D1IngestionSessionRepository } from "./persistence/d1/ingestion-session-repository";
import { R2SourceArtifactStore } from "./persistence/r2/source-artifact-store";
import { loadIngestionAttachmentParts } from "./tools/attachments";

export async function regenerateDraftOperation(
  env: Env,
  sessionId: string,
  userId: string,
  params: { operationIndex: number; feedback?: string },
  events: ExecutionEventSink = noopExecutionEventSink,
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
  const artifacts = new R2SourceArtifactStore(env.BUCKET, sessions);
  const evidence =
    (await artifacts.load(session.contextManifest.sourceArtifact?.key)) ??
    session.inputs.texts.join("\n\n");
  const attachments = await loadIngestionAttachmentParts(env.BUCKET, session.inputs);
  const replacement = await regenerateOperationWithModel(
    env,
    operation,
    evidence,
    attachments,
    params.feedback,
    events,
  );
  await sessions.replaceOperation(sessionId, params.operationIndex, replacement);
  return replacement;
}
