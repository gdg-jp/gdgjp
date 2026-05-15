import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { sendIngestionCompleteEmail } from "../email.server";
import { sendPushToUser } from "../fcm.server";
import {
  type CreateOperation,
  type PageIndexEntry,
  type SensitiveItem,
  type UpdateOperation,
  runPhase0Clarifier,
  runPhase1Planner,
  runPhase2Creator,
  runPhase2Patcher,
} from "../gemini.server";
import { tiptapToMarkdown } from "../tiptap-convert";
import { updateIngestionPhase } from "./helpers";
import { buildPageIndex } from "./page-index";
import type { AiDraftJson, ChangesetOperation, IngestionInputs, SourceUrl } from "./types";

type Db = ReturnType<typeof drizzle>;

interface DraftPhaseParams {
  env: Env;
  db: Db;
  sessionId: string;
  inputs: IngestionInputs;
  currentDatetime: string;
  effectiveUserText: string;
  fileUris: { uri: string; mimeType: string }[];
  docTexts: string[];
  sources: SourceUrl[];
  warnings: string[];
  skipPhase0: boolean;
  isPostClarification: boolean;
}

export async function runDraftPhases(
  params: DraftPhaseParams,
): Promise<{ status: "needs_clarification" } | { status: "done"; aiDraftJson: AiDraftJson }> {
  const {
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
  } = params;

  let pageIndex: PageIndexEntry[];

  if (!isPostClarification) {
    await updateIngestionPhase(db, sessionId, "planning");

    if (skipPhase0) {
      pageIndex = await buildPageIndex(db, effectiveUserText);
    } else {
      const [pageIndexResult, clarifierResult] = await Promise.all([
        buildPageIndex(db, effectiveUserText),
        runPhase0Clarifier(env.GEMINI_API_KEY, effectiveUserText, fileUris, currentDatetime),
      ]);

      if (clarifierResult.needsClarification) {
        const aiDraftJson: AiDraftJson = {
          phase: "clarification",
          questions: clarifierResult.questions,
          summary: clarifierResult.summary,
          fileUris,
          googleDocText: docTexts.join("\n\n---\n\n"),
          sources: sources.length > 0 ? sources : undefined,
        };
        await db
          .update(schema.ingestionSessions)
          .set({
            aiDraftJson: JSON.stringify(aiDraftJson),
            status: "awaiting_clarification",
            phaseMessage: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.ingestionSessions.id, sessionId));
        return { status: "needs_clarification" };
      }

      pageIndex = pageIndexResult;
    }
  } else {
    await updateIngestionPhase(db, sessionId, "planning");
    pageIndex = await buildPageIndex(db, effectiveUserText);
  }

  const plan = await runPhase1Planner(
    env.GEMINI_API_KEY,
    effectiveUserText,
    fileUris,
    pageIndex,
    currentDatetime,
  );

  const updateOps = plan.operations.filter((op) => op.type === "update") as UpdateOperation[];
  const existingContent: Record<string, string> = {};

  for (const op of updateOps) {
    const page = await db
      .select({ contentJa: schema.pages.contentJa })
      .from(schema.pages)
      .where(eq(schema.pages.id, op.pageId))
      .get();
    if (page) {
      existingContent[op.pageId] = page.contentJa;
    }
  }

  const createOps = plan.operations.filter((op) => op.type === "create") as CreateOperation[];
  const total = createOps.length + updateOps.length;
  let done = 0;

  await updateIngestionPhase(db, sessionId, `generating:0/${total}`);

  const assetNames: string[] = [
    ...(inputs.imageFiles && inputs.imageFiles.length > 0
      ? inputs.imageFiles.map((f) => f.name)
      : inputs.imageKeys.map((k) => k.split("/").at(-1) ?? k)),
    ...(inputs.pdfFiles && inputs.pdfFiles.length > 0
      ? inputs.pdfFiles.map((f) => f.name)
      : (inputs.pdfKeys ?? []).map((k) => k.split("/").at(-1) ?? k)),
  ];

  const creatorResults = await Promise.all(
    createOps.map(async (op) => {
      const result = await runPhase2Creator(
        env.GEMINI_API_KEY,
        effectiveUserText,
        fileUris,
        op,
        pageIndex,
        createOps.filter((o) => o.tempId !== op.tempId),
        currentDatetime,
        assetNames,
      );
      done++;
      await updateIngestionPhase(db, sessionId, `generating:${done}/${total}`);
      return result;
    }),
  );

  const patcherResults = await Promise.all(
    updateOps.map(async (op) => {
      const existing = existingContent[op.pageId] ?? "";
      const markdown = tiptapToMarkdown(existing);
      const result = await runPhase2Patcher(
        env.GEMINI_API_KEY,
        effectiveUserText,
        fileUris,
        op,
        markdown,
        currentDatetime,
        assetNames,
      );
      done++;
      await updateIngestionPhase(db, sessionId, `generating:${done}/${total}`);
      return result;
    }),
  );

  const operations: ChangesetOperation[] = [];
  const allSensitiveItems: SensitiveItem[] = [];

  createOps.forEach((op, idx) => {
    const draft = creatorResults[idx];
    operations.push({
      type: "create",
      tempId: op.tempId,
      rationale: op.rationale,
      draft,
      patch: null,
    });
    allSensitiveItems.push(...(draft.sensitiveItems ?? []));
  });

  updateOps.forEach((op, idx) => {
    const patch = patcherResults[idx];
    operations.push({
      type: "update",
      pageId: op.pageId,
      pageTitle: op.pageTitle,
      rationale: op.rationale,
      draft: null,
      patch,
      existingTipTapJson: existingContent[op.pageId],
    });
    allSensitiveItems.push(...(patch.sensitiveItems ?? []));
  });

  return {
    status: "done",
    aiDraftJson: {
      planRationale: plan.planRationale,
      operations,
      sensitiveItems: allSensitiveItems,
      warnings,
      sources,
      imageKeys: inputs.imageKeys,
      pdfKeys: inputs.pdfKeys ?? [],
    },
  };
}

export async function persistDoneAndNotify(
  env: Env,
  db: Db,
  sessionId: string,
  userId: string,
  aiDraftJson: AiDraftJson,
): Promise<void> {
  console.log("[ingestion-pipeline] reached step 8 (saving) for session", sessionId);
  await updateIngestionPhase(db, sessionId, "saving");
  await db
    .update(schema.ingestionSessions)
    .set({
      aiDraftJson: JSON.stringify(aiDraftJson),
      status: "done",
      phaseMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.ingestionSessions.id, sessionId));

  try {
    const reviewUrl = `/ingest/${sessionId}`;
    const notificationId = crypto.randomUUID();
    await db.insert(schema.notifications).values({
      id: notificationId,
      userId,
      type: "ingestion_done",
      titleJa: "下書きの確認準備完了",
      titleEn: "Draft ready for review",
      refId: sessionId,
      refUrl: reviewUrl,
    });

    try {
      const userRow = await db
        .select({ name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .get();

      if (userRow) {
        const siteUrl = (env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
        await sendIngestionCompleteEmail(env, {
          to: userRow.email,
          userName: userRow.name,
          sessionId,
          reviewUrl: `${siteUrl}${reviewUrl}`,
        });
        await db
          .update(schema.notifications)
          .set({ emailedAt: new Date() })
          .where(eq(schema.notifications.id, notificationId));
      }
    } catch (emailErr) {
      console.error(
        `[ingestion-pipeline] email notification failed for session=${sessionId}:`,
        emailErr,
      );
    }

    try {
      await sendPushToUser(
        env,
        userId,
        { title: "下書きの確認準備完了", url: reviewUrl },
        { title: "Draft ready for review", url: reviewUrl },
      );
    } catch (pushErr) {
      console.error(
        `[ingestion-pipeline] push notification failed for session=${sessionId}:`,
        pushErr,
      );
    }
  } catch (notifErr) {
    console.error(
      `[ingestion-pipeline] notification insert failed for session=${sessionId}:`,
      notifErr,
    );
  }

  console.log(
    "[ingestion-pipeline] runIngestionPipeline completed successfully for session",
    sessionId,
  );
}

export async function persistPipelineError(
  env: Env,
  sessionId: string,
  userId: string,
  err: unknown,
): Promise<void> {
  console.error(`[ingestion-pipeline] session=${sessionId} error:`, err);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const isGoogleApiError =
    /google\s*(drive|doc|form)|invalid_grant|invalid_token|refresh.?token|drive\.googleapis\.com|forms\.googleapis\.com|drive\s*api|forms\s*api|oauth|access.?token|UNAUTHENTICATED|認証|接続/i.test(
      rawMessage,
    ) ||
    rawMessage.includes("401") ||
    rawMessage.includes("403");
  const errorMessage = isGoogleApiError ? rawMessage : "Ingestion failed due to an internal error.";
  const errorDb = drizzle(env.DB, { schema });
  try {
    await errorDb
      .update(schema.ingestionSessions)
      .set({
        status: "error",
        errorMessage,
        phaseMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.ingestionSessions.id, sessionId));
  } catch (dbErr) {
    console.error(
      `[ingestion-pipeline] failed to write error status for session=${sessionId}:`,
      dbErr,
    );
  }

  try {
    await errorDb.insert(schema.notifications).values({
      id: crypto.randomUUID(),
      userId,
      type: "ingestion_error",
      titleJa: "処理に失敗しました",
      titleEn: "Processing failed",
      refId: sessionId,
      refUrl: `/ingest/${sessionId}`,
    });

    await sendPushToUser(
      env,
      userId,
      { title: "処理に失敗しました", url: `/ingest/${sessionId}` },
      { title: "Processing failed", url: `/ingest/${sessionId}` },
    ).catch(() => {});
  } catch {
    // never block error handling
  }
}
