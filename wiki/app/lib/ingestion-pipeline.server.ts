/**
 * Full AI ingestion pipeline orchestration.
 *
 * Runs asynchronously via a Cloudflare Queue consumer (or waitUntil in local
 * development fallback paths). Updates ingestion_sessions.status / ai_draft_json
 * when done or on error.
 */

import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { buildUserText } from "./ingestion-pipeline/helpers";
import {
  persistDoneAndNotify,
  persistPipelineError,
  runDraftPhases,
} from "./ingestion-pipeline/run-phases";
import type { IngestionResumeContext } from "./ingestion-pipeline/run-preprocess";
import {
  preparePipelineInputs,
  step26FetchSelectedUrls,
} from "./ingestion-pipeline/run-preprocess";
import type { IngestionInputs } from "./ingestion-pipeline/types";

export type {
  AiDraftJson,
  ClarificationQuestion,
  ClarificationResult,
  ChangesetOperation,
  IngestionInputs,
  IngestionResumePostClarificationDraft,
  IngestionResumePostUrlSelectionDraft,
  SourceUrl,
} from "./ingestion-pipeline/types";
export { buildPageIndex, generateSlug } from "./ingestion-pipeline/page-index";

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export async function runIngestionPipeline(
  env: Env,
  sessionId: string,
  userId: string,
  inputs: IngestionInputs,
  resumeContext?: IngestionResumeContext,
): Promise<void> {
  console.log("[ingestion-pipeline] runIngestionPipeline start", {
    sessionId,
    userId,
    hasResumeContext: !!resumeContext,
    resumeMode:
      resumeContext?.clarificationAnswers !== undefined
        ? resumeContext.selectedUrls
          ? "post_url_selection"
          : "post_clarification"
        : "fresh",
  });

  const db = drizzle(env.DB, { schema });

  const currentDatetime = `${new Date().toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}（JST）`;

  try {
    const prepared = await preparePipelineInputs(env, db, sessionId, userId, inputs, resumeContext);
    if (prepared.status === "awaiting_url_selection") return;

    const {
      baseUserText,
      fileUris,
      warnings,
      docTexts,
      sources,
      skipPhase0,
      isPostClarification,
      isPostUrlSelection,
      clarificationAnswers,
    } = prepared.data;

    if (
      isPostUrlSelection &&
      resumeContext?.selectedUrls &&
      resumeContext.selectedUrls.length > 0
    ) {
      await step26FetchSelectedUrls(
        env,
        db,
        sessionId,
        resumeContext.selectedUrls,
        fileUris,
        docTexts,
        sources,
      );
    }

    // Build final user text (prepend clarification answers if resuming)
    const userText = buildUserText(baseUserText, docTexts);

    const effectiveUserText = isPostClarification
      ? `${clarificationAnswers}\n\n${userText}`
      : userText;

    console.log(
      "[ingestion-pipeline] effectiveUserText length:",
      effectiveUserText.length,
      "fileUris:",
      fileUris.length,
    );

    const draftResult = await runDraftPhases({
      env,
      db,
      sessionId,
      inputs,
      currentDatetime,
      effectiveUserText,
      fileUris,
      docTexts,
      sources,
      warnings,
      skipPhase0,
      isPostClarification,
    });
    if (draftResult.status === "needs_clarification") return;

    await persistDoneAndNotify(env, db, sessionId, userId, draftResult.aiDraftJson);
  } catch (err) {
    await persistPipelineError(env, sessionId, userId, err);
  }
}
