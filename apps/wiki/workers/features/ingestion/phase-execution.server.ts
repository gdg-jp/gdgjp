import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type { AiDraftJson, IngestionInputs } from "../../../shared/ingestion/domain";
import type { GenerationObservability, GenerationTraceContext } from "./observability";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
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
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): Promise<void> {
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
  if (!session || session.userId !== request.userId) {
    if (observability && trace) {
      observability.event("session_skipped", trace, {
        outcome: "not_owned_or_missing",
      });
    }
    return;
  }
  if (session.status !== "processing") {
    if (observability && trace) {
      observability.event("session_skipped", trace, {
        outcome: "not_processing",
        data: { status: session.status },
      });
    }
    return;
  }

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
    if (observability && trace) {
      observability.event("session_inputs_invalid", trace, { outcome: "error" }, "error");
    }
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
      priorSources: draft.sources,
    };
  } else if (request.resumeMode === "post_url_selection") {
    if (!draft || draft.phase !== "resume_post_url_selection") {
      throw new Error("Invalid URL selection resume context");
    }
    resumeContext = {
      fileUris: draft.fileUris,
      clarificationAnswers: "",
      selectedUrls: draft.selectedUrls,
      priorSources: draft.sources,
      skipClarification: draft.skipClarification,
    };
  }

  await runIngestion(
    env,
    session.id,
    session.userId,
    inputs,
    resumeContext,
    events,
    observability,
    trace,
  );
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
    if (observability && trace) {
      observability.event("pipeline_incomplete", trace, { outcome: "error" }, "error");
    }
  }
}
