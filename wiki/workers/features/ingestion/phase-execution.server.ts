import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type { AiDraftJson, IngestionInputs } from "../../../shared/ingestion/domain";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { D1IngestionSessionRepository } from "./persistence/d1/ingestion-session-repository";
import { R2SourceArtifactStore } from "./persistence/r2/source-artifact-store";
import type { IngestionExecutionRequest } from "./persistence/serialization/session-execution";
import { parseSessionInputsJson } from "./persistence/serialization/session-execution";
import { runIngestion } from "./phase-runner.server";
import type { IngestionResumeContext } from "./source-preparation.server";

type Db = ReturnType<typeof drizzle>;

function parseDraft(value: string | null): AiDraftJson | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as AiDraftJson;
  } catch {
    return null;
  }
}

export async function executeIngestionPhase(
  env: Env,
  db: Db,
  request: IngestionExecutionRequest,
  events: ExecutionEventSink = noopExecutionEventSink,
): Promise<void> {
  const artifacts = new R2SourceArtifactStore(env.BUCKET, new D1IngestionSessionRepository(env.DB));
  const session = await db
    .select({
      id: schema.ingestionSessions.id,
      userId: schema.ingestionSessions.userId,
      status: schema.ingestionSessions.status,
      inputsJson: schema.ingestionSessions.inputsJson,
      aiDraftJson: schema.ingestionSessions.aiDraftJson,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, request.sessionId))
    .get();
  if (!session || session.userId !== request.userId) return;
  if (session.status !== "processing") return;

  let inputs: IngestionInputs;
  try {
    inputs = parseSessionInputsJson(session.inputsJson);
  } catch {
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "error",
        errorMessage: "Ingestion session inputs are invalid.",
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
    return;
  }

  let resumeContext: IngestionResumeContext | undefined;
  const draft = parseDraft(session.aiDraftJson);
  if (request.resumeMode === "post_clarification") {
    if (!draft || draft.phase !== "resume_post_clarification") {
      throw new Error("Invalid clarification resume context");
    }
    resumeContext = {
      fileUris: draft.fileUris,
      clarificationAnswers: draft.clarificationAnswers,
      googleDocText: (await artifacts.load(draft.sourceArtifactKey)) ?? draft.googleDocText,
      priorSources: draft.sources,
      sourceArtifactKey: draft.sourceArtifactKey,
    };
  } else if (request.resumeMode === "post_url_selection") {
    if (!draft || draft.phase !== "resume_post_url_selection") {
      throw new Error("Invalid URL selection resume context");
    }
    resumeContext = {
      fileUris: draft.fileUris,
      clarificationAnswers: "",
      googleDocText: (await artifacts.load(draft.sourceArtifactKey)) ?? draft.googleDocText,
      selectedUrls: draft.selectedUrls,
      sourceArtifactKey: draft.sourceArtifactKey,
    };
  }

  await runIngestion(env, session.id, session.userId, inputs, resumeContext, events);
  const finalSession = await db
    .select({ status: schema.ingestionSessions.status })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, session.id))
    .get();
  if (finalSession?.status === "processing") {
    await db
      .update(schema.ingestionSessions)
      .set({
        status: "error",
        errorMessage: "Ingestion pipeline did not complete.",
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, session.id));
  }
}
