import { nanoid } from "nanoid";
import * as schema from "../../../../../app/db/schema";
import { MAX_SENDER_SAMPLES, pruneSenderSamplesStatement } from "../../chat-sender-registry";
import { metaGet, metaSet } from "../run";
import {
  type ChatImportTickContext,
  type Current,
  SENDERS_FLUSH_BATCH_SIZE,
  type StepOutcome,
  log,
} from "./shared";

export async function stepSenders(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "senders_flushed") !== "1") {
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    ctx.budget.spend(1);
    const configured = new Set(
      (
        await current.db
          .select({ resourceName: schema.googleChatSenderProfiles.resourceName })
          .from(schema.googleChatSenderProfiles)
          .all()
      ).map((row) => row.resourceName),
    );

    const senders = ctx.sql
      .exec<{ resource_name: string }>(
        "SELECT DISTINCT resource_name FROM sender_samples ORDER BY resource_name",
      )
      .toArray();
    let cursor = Number(metaGet(ctx.sql, "senders_flush_index") ?? "0");
    const db = current.db;
    const now = new Date();

    while (cursor < senders.length) {
      if (!ctx.budget.canSpend(1)) {
        metaSet(ctx.sql, "senders_flush_index", String(cursor));
        return { phaseComplete: false };
      }

      const batch: string[] = [];
      let next = cursor;
      while (next < senders.length && batch.length < SENDERS_FLUSH_BATCH_SIZE) {
        const resourceName = senders[next]?.resource_name;
        next += 1;
        if (!resourceName || configured.has(resourceName)) continue;
        batch.push(resourceName);
      }

      if (batch.length === 0) {
        cursor = next;
        metaSet(ctx.sql, "senders_flush_index", String(cursor));
        continue;
      }

      const statements = [];
      for (const resourceName of batch) {
        const samples = ctx.sql
          .exec<{ message_name: string; create_time: string; message_text: string }>(
            `SELECT message_name, create_time, message_text FROM sender_samples
             WHERE resource_name = ?
             ORDER BY create_time DESC, message_name DESC
             LIMIT ?`,
            resourceName,
            MAX_SENDER_SAMPLES,
          )
          .toArray();
        for (const sample of samples) {
          statements.push(
            db
              .insert(schema.googleChatSenderSamples)
              .values({
                id: nanoid(),
                resourceName,
                sourceId: current.source.id,
                messageName: sample.message_name,
                messageText: sample.message_text,
                createdAt: new Date(sample.create_time),
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: [
                  schema.googleChatSenderSamples.resourceName,
                  schema.googleChatSenderSamples.sourceId,
                  schema.googleChatSenderSamples.messageName,
                ],
                set: {
                  messageText: sample.message_text,
                  createdAt: new Date(sample.create_time),
                  updatedAt: now,
                },
              }),
          );
        }
        if (samples.length > 0) {
          statements.push(pruneSenderSamplesStatement(db, resourceName));
        }
      }

      ctx.budget.spend(1);
      if (statements.length > 0) {
        await db.batch(statements as [(typeof statements)[0], ...typeof statements]);
      }
      cursor = next;
      metaSet(ctx.sql, "senders_flush_index", String(cursor));
    }
    metaSet(ctx.sql, "senders_flushed", "1");
  }

  const counts = ctx.sql
    .exec<{ total: number; unresolved: number | null }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN display_name IS NULL THEN 1 ELSE 0 END) AS unresolved
       FROM senders`,
    )
    .one();
  log("senders_resolved", {
    sourceId: current.source.id,
    runId: ctx.runId,
    total: counts.total,
    unresolved: counts.unresolved ?? 0,
  });
  return { phaseComplete: true };
}
