import { getAgentByName } from "agents";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type { WikiIngestionAgent } from "../../workers/ingestion-agent";
import { indexPageEmbeddings } from "./embedding-pipeline.server";
import { createGeminiGenerationProvider } from "./gemini/gemini-generation-provider.server";
import type { IngestionExecutionRequest } from "./ingestion-jobs.server";
import { parseSessionInputsJson } from "./ingestion-jobs.server";
import type { AiDraftJson, IngestionInputs, SourceUrl } from "./ingestion-pipeline.server";
import { runIngestionPipeline } from "./ingestion-pipeline.server";
import type { IngestionResumeContext } from "./ingestion-pipeline/run-preprocess";
import { loadNormalizedSource } from "./source-artifacts.server";

type Db = ReturnType<typeof drizzle>;

function isTranslationQueueMessage(body: unknown): body is { pageId: string } {
  if (typeof body !== "object" || body === null) return false;
  return typeof (body as Record<string, unknown>).pageId === "string";
}

export function isTranslationQueueBody(body: unknown): body is { pageId: string } {
  return isTranslationQueueMessage(body);
}

export async function processIngestionMessage(
  env: Env,
  db: Db,
  body: IngestionExecutionRequest,
): Promise<void> {
  console.log("[ingestion-jobs] processIngestionMessage called", {
    sessionId: body.sessionId,
    userId: body.userId,
    resumeMode: body.resumeMode,
  });

  const session = await db
    .select({
      id: schema.ingestionSessions.id,
      userId: schema.ingestionSessions.userId,
      status: schema.ingestionSessions.status,
      inputsJson: schema.ingestionSessions.inputsJson,
      aiDraftJson: schema.ingestionSessions.aiDraftJson,
    })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, body.sessionId))
    .get();

  if (!session) {
    console.warn("[ingestion-jobs] session not found, dropping", body.sessionId);
    return;
  }

  console.log("[ingestion-jobs] session fetched", { id: session.id, status: session.status });

  if (session.userId !== body.userId) {
    console.warn("[ingestion-jobs] session user mismatch, dropping", body.sessionId);
    return;
  }

  if (session.status !== "processing") {
    console.log(
      "[ingestion-jobs] session is not processing, skipping",
      body.sessionId,
      "status:",
      session.status,
    );
    return;
  }

  let inputs: IngestionInputs;
  try {
    inputs = parseSessionInputsJson(session.inputsJson);
    console.log("[ingestion-jobs] inputs parsed ok, texts.length:", inputs.texts.length);
  } catch (parseErr) {
    console.error("[ingestion-jobs] failed to parse inputs:", parseErr);
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

  if (body.resumeMode === "post_clarification") {
    console.log(
      "[ingestion-jobs] resume mode: post_clarification, aiDraftJson length:",
      session.aiDraftJson?.length ?? 0,
    );
    let draft: AiDraftJson | null = null;
    try {
      draft = session.aiDraftJson ? (JSON.parse(session.aiDraftJson) as AiDraftJson) : null;
    } catch {
      draft = null;
    }
    console.log("[ingestion-jobs] parsed draft phase:", draft?.phase ?? "(null)");
    if (!draft || draft.phase !== "resume_post_clarification") {
      console.error(
        "[ingestion-jobs] invalid resume context for post_clarification, draft phase:",
        draft?.phase,
      );
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "error",
          errorMessage: "Ingestion resume context is invalid.",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, session.id));
      return;
    }
    resumeContext = {
      fileUris: draft.fileUris,
      clarificationAnswers: draft.clarificationAnswers,
      googleDocText: draft.googleDocText,
      priorSources: draft.sources,
      sourceArtifactKey: draft.sourceArtifactKey,
    };
    resumeContext.googleDocText =
      (await loadNormalizedSource(env, draft.sourceArtifactKey)) ?? resumeContext.googleDocText;
  } else if (body.resumeMode === "post_url_selection") {
    console.log(
      "[ingestion-jobs] resume mode: post_url_selection, aiDraftJson length:",
      session.aiDraftJson?.length ?? 0,
    );
    let draft: AiDraftJson | null = null;
    try {
      draft = session.aiDraftJson ? (JSON.parse(session.aiDraftJson) as AiDraftJson) : null;
    } catch {
      draft = null;
    }
    console.log("[ingestion-jobs] parsed draft phase:", draft?.phase ?? "(null)");
    if (!draft || draft.phase !== "resume_post_url_selection") {
      console.error(
        "[ingestion-jobs] invalid resume context for post_url_selection, draft phase:",
        draft?.phase,
      );
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "error",
          errorMessage: "Ingestion resume context is invalid.",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, session.id));
      return;
    }
    resumeContext = {
      fileUris: draft.fileUris,
      clarificationAnswers: "",
      googleDocText: draft.googleDocText,
      selectedUrls: draft.selectedUrls,
      sourceArtifactKey: draft.sourceArtifactKey,
    };
    resumeContext.googleDocText =
      (await loadNormalizedSource(env, draft.sourceArtifactKey)) ?? resumeContext.googleDocText;
  } else {
    console.log("[ingestion-jobs] fresh run (no resumeMode)");
  }

  console.log("[ingestion-jobs] calling runIngestionPipeline", {
    sessionId: session.id,
    resumeMode: body.resumeMode,
  });
  await runIngestionPipeline(env, session.id, session.userId, inputs, resumeContext);
  console.log("[ingestion-jobs] runIngestionPipeline returned for session", session.id);

  // Safety net: if the pipeline returned without transitioning the session
  // away from "processing", mark it as error so the UI stops spinning.
  const afterRun = await db
    .select({ status: schema.ingestionSessions.status })
    .from(schema.ingestionSessions)
    .where(eq(schema.ingestionSessions.id, session.id))
    .get();
  console.log("[ingestion-jobs] status after pipeline:", afterRun?.status ?? "(not found)");
  if (afterRun?.status === "processing") {
    console.warn(
      "[ingestion-jobs] safety net triggered: session still 'processing' after pipeline returned, forcing error",
    );
    try {
      await db
        .update(schema.ingestionSessions)
        .set({
          status: "error",
          errorMessage: "Ingestion pipeline did not complete.",
          phaseMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.ingestionSessions.id, session.id));
    } catch {
      // best-effort; already logged above
    }
  }
}

export async function processTranslationMessage(
  env: Env,
  db: Db,
  body: { pageId: string },
): Promise<void> {
  const { pageId } = body;
  console.log("translation-jobs: processing page", pageId);

  const page = await db
    .select({
      contentJa: schema.pages.contentJa,
      titleJa: schema.pages.titleJa,
      summaryJa: schema.pages.summaryJa,
    })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();

  if (!page) {
    console.warn("translation-jobs: page not found", pageId);
    return;
  }

  const { contentEn, titleEn, summaryEn } = await createGeminiGenerationProvider(
    env.GEMINI_API_KEY,
  ).translate({ contentJa: page.contentJa, titleJa: page.titleJa, summaryJa: page.summaryJa });

  await db
    .update(schema.pages)
    .set({
      contentEn,
      titleEn,
      summaryEn,
      translationStatusEn: "ai",
      updatedAt: new Date(),
    })
    .where(eq(schema.pages.id, pageId));

  // Non-blocking: embedding failure should not fail translation
  try {
    await indexPageEmbeddings(env, db, pageId);
  } catch (err) {
    console.error("embedding-pipeline: failed after translation", pageId, err);
  }

  console.log("translation-jobs: done", pageId);
}

// ---------------------------------------------------------------------------
// Local dev fallback: send to queue or run inline if queue unavailable
// ---------------------------------------------------------------------------

/**
 * Sends an ingestion job to the queue. In local dev where INGESTION_QUEUE is
 * not bound, falls back to running the job inline via ctx.waitUntil().
 */
export async function sendOrRunIngestion(
  env: Env,
  ctx: ExecutionContext,
  message: import("./ingestion-jobs.server").IngestionQueueMessage,
): Promise<void> {
  if (env.INGESTION_QUEUE && (env.ENVIRONMENT as string) !== "development") {
    console.log("[ingestion-jobs] sending to INGESTION_QUEUE", {
      sessionId: message.sessionId,
      version: message.version,
    });
    await env.INGESTION_QUEUE.send(message);
    console.log("[ingestion-jobs] INGESTION_QUEUE.send() succeeded");
  } else {
    console.warn("[ingestion-jobs] starting agent directly (local dev or queue unavailable)", {
      sessionId: message.sessionId,
      environment: env.ENVIRONMENT,
    });
    const agent = await getAgentByName<Env, WikiIngestionAgent>(
      env.INGESTION_AGENT,
      message.sessionId,
    );
    ctx.waitUntil(agent.startIngestion(message.sessionId, message.userId));
    console.log("[ingestion-jobs] agent start scheduled with ctx.waitUntil");
  }
}

export async function sendOrRunTranslation(
  env: Env,
  ctx: ExecutionContext,
  pageId: string,
): Promise<void> {
  if (env.TRANSLATION_QUEUE && (env.ENVIRONMENT as string) !== "development") {
    await env.TRANSLATION_QUEUE.send({ pageId });
  } else {
    console.warn("translation-jobs: running inline (local dev or queue unavailable)");
    const db = drizzle(env.DB, { schema });
    ctx.waitUntil(processTranslationMessage(env, db, { pageId }));
  }
}
