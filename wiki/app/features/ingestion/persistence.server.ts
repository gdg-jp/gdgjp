import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { sendIngestionCompleteEmail } from "~/lib/email.server";
import { sendPushToUser } from "~/lib/fcm.server";
import type { AiDraftJson } from "./contracts";

type Db = ReturnType<typeof drizzle>;

export async function updateIngestionPhase(
  db: Db,
  sessionId: string,
  message: string,
): Promise<void> {
  await db
    .update(schema.ingestionSessions)
    .set({ phaseMessage: message, updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
}

export async function persistDoneAndNotify(
  env: Env,
  db: Db,
  sessionId: string,
  userId: string,
  aiDraftJson: AiDraftJson,
): Promise<void> {
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

  const reviewUrl = `/ingest/${sessionId}`;
  const notificationId = `ingestion:${sessionId}:done`;
  const inserted = await db
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
  if (inserted.meta.changes === 0) return;

  const user = await db
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get();
  if (user) {
    try {
      const baseUrl = (env.APP_URL ?? "").replace(/\/$/, "");
      await sendIngestionCompleteEmail(env, {
        to: user.email,
        userName: user.name,
        sessionId,
        reviewUrl: `${baseUrl}${reviewUrl}`,
      });
      await db
        .update(schema.notifications)
        .set({ emailedAt: new Date() })
        .where(eq(schema.notifications.id, notificationId));
    } catch (error) {
      console.error(JSON.stringify({ component: "generation", event: "email_failed", sessionId }));
    }
  }
  try {
    await sendPushToUser(
      env,
      userId,
      { title: "下書きの確認準備完了", url: reviewUrl },
      { title: "Draft ready for review", url: reviewUrl },
    );
  } catch {
    console.error(JSON.stringify({ component: "generation", event: "push_failed", sessionId }));
  }
}

export async function persistIngestionError(
  env: Env,
  sessionId: string,
  userId: string,
  error: unknown,
): Promise<void> {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const isProviderError =
    /google\s*(drive|doc|form)|invalid_grant|invalid_token|refresh.?token|oauth|access.?token|UNAUTHENTICATED|認証|接続/i.test(
      rawMessage,
    ) || /\b40[13]\b/.test(rawMessage);
  const errorMessage = isProviderError ? rawMessage : "Ingestion failed due to an internal error.";
  const db = drizzle(env.DB, { schema });
  await db
    .update(schema.ingestionSessions)
    .set({ status: "error", errorMessage, phaseMessage: null, updatedAt: new Date() })
    .where(eq(schema.ingestionSessions.id, sessionId));
  try {
    const inserted = await db
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
    if (inserted.meta.changes > 0) {
      await sendPushToUser(
        env,
        userId,
        { title: "処理に失敗しました", url: `/ingest/${sessionId}` },
        { title: "Processing failed", url: `/ingest/${sessionId}` },
      );
    }
  } catch {
    // Error persistence must not be masked by notification failures.
  }
}
