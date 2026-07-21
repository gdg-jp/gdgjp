import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { sendIngestionCompleteEmail } from "../email.server";
import { sendPushToUser } from "../fcm.server";
import type {
  CreateOperation,
  PageIndexEntry,
  SensitiveItem,
  UpdateOperation,
} from "../gemini.server";
import { createGeminiGenerationProvider } from "../gemini/gemini-generation-provider.server";
import { tiptapToMarkdown } from "../tiptap-convert";
import { updateIngestionPhase } from "./helpers";
import { buildKnowledgeContext } from "./knowledge-context";
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
  sourceArtifactKey?: string;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
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
    sourceArtifactKey,
  } = params;
  const provider = createGeminiGenerationProvider(env.GEMINI_API_KEY);

  let pageIndex: PageIndexEntry[];

  if (!isPostClarification) {
    await updateIngestionPhase(db, sessionId, "planning");

    if (skipPhase0) {
      pageIndex = await buildKnowledgeContext({
        env,
        db,
        sessionId,
        userText: effectiveUserText,
        files: fileUris,
      });
    } else {
      const [pageIndexResult, clarifierResult] = await Promise.all([
        buildKnowledgeContext({
          env,
          db,
          sessionId,
          userText: effectiveUserText,
          files: fileUris,
        }),
        provider.clarify({
          userText: effectiveUserText,
          files: fileUris,
          currentDatetime,
        }),
      ]);

      if (clarifierResult.needsClarification) {
        const aiDraftJson: AiDraftJson = {
          phase: "clarification",
          questions: clarifierResult.questions,
          summary: clarifierResult.summary,
          fileUris,
          // New sessions reconstruct normalized source text from R2 after a human wait.
          // Keep the inline field only as a compatibility fallback for pre-migration drafts.
          googleDocText: sourceArtifactKey ? undefined : docTexts.join("\n\n---\n\n"),
          sources: sources.length > 0 ? sources : undefined,
          sourceArtifactKey,
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
    pageIndex = await buildKnowledgeContext({
      env,
      db,
      sessionId,
      userText: effectiveUserText,
      files: fileUris,
    });
  }

  const plan = await provider.plan({
    userText: effectiveUserText,
    files: fileUris,
    pageIndex,
    currentDatetime,
  });

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

  const creatorResults = await mapWithConcurrency(createOps, 2, async (op) => {
    const result = await provider.create({
      userText: effectiveUserText,
      files: fileUris,
      operation: op,
      pageIndex,
      siblingOperations: createOps.filter((o) => o.tempId !== op.tempId),
      currentDatetime,
      imageNames: assetNames,
    });
    done++;
    await updateIngestionPhase(db, sessionId, `generating:${done}/${total}`);
    return result;
  });

  const patcherResults = await mapWithConcurrency(updateOps, 2, async (op) => {
    const existing = existingContent[op.pageId] ?? "";
    const markdown = tiptapToMarkdown(existing);
    const result = await provider.patch({
      userText: effectiveUserText,
      files: fileUris,
      operation: op,
      existingMarkdown: markdown,
      currentDatetime,
      imageNames: assetNames,
    });
    done++;
    await updateIngestionPhase(db, sessionId, `generating:${done}/${total}`);
    return result;
  });

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
    const notificationId = `ingestion:${sessionId}:done`;
    const notificationInsert = await db
      .insert(schema.notifications)
      .values({
        id: notificationId,
        userId,
        type: "ingestion_done",
        titleJa: "下書きの確認準備完了",
        titleEn: "Draft ready for review",
        refId: sessionId,
        refUrl: reviewUrl,
      })
      .onConflictDoNothing()
      .run();
    if (notificationInsert.meta.changes === 0) return;

    try {
      const userRow = await db
        .select({ name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
        .get();

      if (userRow) {
        const siteUrl = (env.APP_URL ?? "").replace(/\/$/, "");
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
  const errorCode =
    err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;
  const errorMessage =
    errorCode === "source_context_too_large"
      ? "Source material exceeds the AI context limit. Split it into smaller ingestions and retry."
      : isGoogleApiError
        ? rawMessage
        : "Ingestion failed due to an internal error.";
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
    const notificationInsert = await errorDb
      .insert(schema.notifications)
      .values({
        id: `ingestion:${sessionId}:error`,
        userId,
        type: "ingestion_error",
        titleJa: "処理に失敗しました",
        titleEn: "Processing failed",
        refId: sessionId,
        refUrl: `/ingest/${sessionId}`,
      })
      .onConflictDoNothing()
      .run();

    if (notificationInsert.meta.changes === 0) return;

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
