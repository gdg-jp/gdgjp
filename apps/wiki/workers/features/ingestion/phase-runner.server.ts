import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../app/db/schema";
import type { AccessContext, AiDraftJson, IngestionInputs } from "../../../shared/ingestion/domain";
import {
  clarifySources,
  generateOperations,
  generationManifest,
  planGeneration,
} from "./generation-adapter.server";
import type { GenerationObservability, GenerationTraceContext } from "./observability";
import { runGenerationValidation } from "./orchestration/generation-validation";
import type { ExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import { noopExecutionEventSink } from "./orchestration/ports/tool-event-sink";
import {
  persistDoneAndNotify,
  updateIngestionPhase,
} from "./persistence/ingestion-result-writer.server";
import { parseIngestionContextManifest } from "./persistence/serialization/context-manifest-codec";
import { type IngestionResumeContext, prepareSources } from "./source-preparation.server";

function parseAccessContext(value: string | null, userId: string): AccessContext {
  if (value) {
    try {
      const parsed = JSON.parse(value) as AccessContext;
      if (parsed.userId === userId) return parsed;
    } catch {
      // Old sessions did not store an access snapshot. They receive the least privilege fallback.
    }
  }
  return {
    userId,
    email: "",
    isAdmin: false,
    chapterIds: [],
    capturedAt: new Date().toISOString(),
    claimsAvailable: false,
    source: "system",
  };
}

export async function runIngestion(
  env: Env,
  sessionId: string,
  userId: string,
  inputs: IngestionInputs,
  resume?: IngestionResumeContext,
  events: ExecutionEventSink = noopExecutionEventSink,
  observability?: GenerationObservability,
  trace?: GenerationTraceContext,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  const sourcePreparationStartedAt = Date.now();
  const prepared = await prepareSources(env, db, sessionId, userId, inputs, resume, events);
  if (observability && trace) {
    observability.event("source_preparation_completed", trace, {
      outcome: prepared.status,
      durationMs: Date.now() - sourcePreparationStartedAt,
      data: {
        sourceCount: prepared.status === "continue" ? prepared.data.sources.length : undefined,
      },
    });
  }
  if (prepared.status === "awaiting_url_selection") return;

  const session = await db
    .select({
      access: schema.ingestionSessions.accessContextJson,
      manifest: schema.ingestionSessions.contextManifestJson,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, sessionId))
    .get();
  if (!session) throw new Error("Ingestion session not found");
  const access = parseAccessContext(session.access, userId);
  const contextManifest = parseIngestionContextManifest(session.manifest);
  const context = {
    db,
    actor: {
      userId,
      email: access.email,
      isAdmin: access.isAdmin,
      chapterIds: access.chapterIds,
    },
    userInput: prepared.data.userInput,
    clarificationAnswers: prepared.data.clarificationAnswers,
    sourceNodes: contextManifest.sourceNodes ?? [],
    inputs,
  };

  if (!prepared.data.skipClarification && !prepared.data.isPostClarification) {
    if (observability && trace) {
      observability.event("state_transition", trace, {
        outcome: "clarifying",
        data: { state: "clarifying" },
      });
    }
    await updateIngestionPhase(db, sessionId, "clarifying");
    const clarification = await clarifySources(env, context, events, observability, trace);
    if (clarification.result.needsClarification) {
      const draft: AiDraftJson = {
        phase: "clarification",
        questions: clarification.result.questions,
        summary: clarification.result.summary,
        fileUris: prepared.data.fileUris,
        sources: prepared.data.sources.length ? prepared.data.sources : undefined,
      };
      await db
        .update(schema.ingestionSessions)
        .set({
          aiDraftJson: JSON.stringify(draft),
          status: "awaiting_clarification",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, sessionId));
      return;
    }
  }

  if (observability && trace) {
    observability.event("state_transition", trace, {
      outcome: "planning",
      data: { state: "planning" },
    });
  }
  await updateIngestionPhase(db, sessionId, "planning");
  const planned = await planGeneration(env, context, events, observability, trace);
  if (observability && trace) {
    observability.event("state_transition", trace, {
      outcome: "generating",
      data: { state: "generating", operationCount: planned.plan.operations.length },
    });
  }
  await updateIngestionPhase(db, sessionId, `generating:0/${planned.plan.operations.length}`);
  const operations = await generateOperations(
    env,
    context,
    planned.plan,
    planned.manifest,
    events,
    observability,
    trace,
  );
  const validationStartedAt = Date.now();
  try {
    await runGenerationValidation({ operations, workspace: planned.manifest });
    if (observability && trace) {
      observability.event("validation_completed", trace, {
        outcome: "success",
        durationMs: Date.now() - validationStartedAt,
        data: { operationCount: operations.length },
      });
    }
  } catch (error) {
    if (observability && trace) {
      observability.event(
        "validation_failed",
        trace,
        {
          outcome: "error",
          durationMs: Date.now() - validationStartedAt,
          data: { error, operationCount: operations.length },
        },
        "error",
      );
    }
    throw error;
  }
  const sensitiveItems = operations.flatMap(
    (operation) => operation.draft?.sensitiveItems ?? operation.patch?.sensitiveItems ?? [],
  );
  const result: AiDraftJson = {
    phase: "result",
    planRationale: planned.plan.planRationale,
    operations,
    sensitiveItems,
    warnings: prepared.data.warnings,
    sources: prepared.data.sources,
    imageKeys: inputs.imageKeys,
    pdfKeys: inputs.pdfKeys ?? [],
    clarificationAnswers: prepared.data.clarificationAnswers,
  };
  const latestSession = await db
    .select({ manifest: schema.ingestionSessions.contextManifestJson })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, sessionId))
    .get();
  const latestManifest = parseIngestionContextManifest(latestSession?.manifest ?? null);
  const sourceHashes = (latestManifest.sourceNodes ?? []).flatMap((node) =>
    node.sha256 ? [node.sha256] : [],
  );
  await db
    .update(schema.ingestionSessions)
    .set({
      contextManifestJson: JSON.stringify({
        ...latestManifest,
        generation: generationManifest(env, planned.manifest, sourceHashes),
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.ingestionSessions.id, sessionId));
  const persistenceStartedAt = Date.now();
  await persistDoneAndNotify(env, db, sessionId, userId, result);
  if (observability && trace) {
    observability.event("result_persisted", trace, {
      outcome: "success",
      durationMs: Date.now() - persistenceStartedAt,
      data: { operationCount: operations.length },
    });
  }
}
