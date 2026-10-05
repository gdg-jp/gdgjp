import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import type { ResolvedSourceAsset } from "../../assets";
import {
  type ChatMessage,
  THREAD_PARENT_UNAVAILABLE,
  defaultSenderName,
  fetchThreadParentText,
  mergeDocumentUrls,
  normalizeChatMessages,
  warnGoogleChat,
} from "../../google-chat";
import { MARKDOWN_MEDIA_TYPE, markdownBody, pathForMediaType } from "../../media-type";
import { persistSourceDocument } from "../../persist";
import { archiveMissingDocuments } from "../archive";
import {
  ARCHIVE_MISSING_SUBREQUESTS,
  PERSIST_MERGE_SUBREQUESTS,
  PERSIST_REPLACE_SUBREQUESTS,
  metaGet,
  metaSet,
} from "../run";
import {
  type ChatImportTickContext,
  type Current,
  type StepOutcome,
  log,
  requireAccessToken,
  spaceNameOf,
} from "./shared";

export async function stepGrouping(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "weeks_flushed") !== "1") {
    const weekPaths = ctx.sql
      .exec<{ week_path: string }>(
        "SELECT DISTINCT week_path FROM week_messages ORDER BY week_path",
      )
      .toArray();
    let sortIndex = Number(metaGet(ctx.sql, "weeks_flush_index") ?? "0");
    while (sortIndex < weekPaths.length) {
      if (!ctx.budget.canSpend(1)) {
        metaSet(ctx.sql, "weeks_flush_index", String(sortIndex));
        return { phaseComplete: false };
      }
      const weekPath = weekPaths[sortIndex]?.week_path;
      if (!weekPath) break;
      const messages = ctx.sql
        .exec<{ message_json: string }>(
          `SELECT message_json FROM week_messages
           WHERE week_path = ? ORDER BY thread_name, create_time, id`,
          weekPath,
        )
        .toArray()
        .map((row) => JSON.parse(row.message_json) as ChatMessage);
      const r2Key = `raw/${current.source.id}/chat-runs/${ctx.runId}/weeks/${weekPath}.json`;
      ctx.budget.spend(1);
      await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
        httpMetadata: { contentType: "application/json" },
      });
      ctx.sql.exec(
        `INSERT INTO week_documents (week_path, r2_key, sort_index) VALUES (?, ?, ?)
         ON CONFLICT(week_path) DO UPDATE SET r2_key = excluded.r2_key, sort_index = excluded.sort_index`,
        weekPath,
        r2Key,
        sortIndex,
      );
      sortIndex += 1;
      metaSet(ctx.sql, "weeks_flush_index", String(sortIndex));
    }
    metaSet(ctx.sql, "weeks_flushed", "1");
  }

  if (metaGet(ctx.sql, "parents_done") !== "1") {
    const token = requireAccessToken(ctx);
    const missing = ctx.sql
      .exec<{ thread_name: string }>(
        `SELECT r.thread_name AS thread_name
         FROM reply_threads r
         LEFT JOIN thread_parents p ON p.thread_name = r.thread_name
         WHERE p.thread_name IS NULL
         ORDER BY r.thread_name`,
      )
      .toArray();
    for (const { thread_name: threadName } of missing) {
      if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
      const parentText = await fetchThreadParentText(
        spaceNameOf(current.source),
        token,
        threadName,
        { onFetch: () => ctx.budget.spend(1) },
      );
      ctx.sql.exec(
        "INSERT OR IGNORE INTO thread_parents (thread_name, parent_text) VALUES (?, ?)",
        threadName,
        parentText ?? THREAD_PARENT_UNAVAILABLE,
      );
    }
    metaSet(ctx.sql, "parents_done", "1");
  }

  return { phaseComplete: true };
}

export async function stepFinalizing(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  const weeks = ctx.sql
    .exec<{ week_path: string; r2_key: string; sort_index: number }>(
      "SELECT week_path, r2_key, sort_index FROM week_documents ORDER BY sort_index",
    )
    .toArray();
  let weeksDone = Number(metaGet(ctx.sql, "weeks_done") ?? "0");
  const incremental = Boolean(current.run.sinceCursor);
  const persistCost = incremental ? PERSIST_MERGE_SUBREQUESTS : PERSIST_REPLACE_SUBREQUESTS;
  // R2 get week + persist. Sender samples are flushed in stepSenders; Markdown
  // always uses placeholders (BOT names from DO senders only).
  const weekUnitCost = 1 + persistCost;

  const senderNames = new Map(
    ctx.sql
      .exec<{ resource_name: string; display_name: string }>(
        "SELECT resource_name, display_name FROM senders WHERE display_name IS NOT NULL",
      )
      .toArray()
      .map((row) => [row.resource_name, row.display_name] as const),
  );
  const threadParents = new Map(
    ctx.sql
      .exec<{ thread_name: string; parent_text: string }>(
        "SELECT thread_name, parent_text FROM thread_parents",
      )
      .toArray()
      .map((row) => [row.thread_name, row.parent_text] as const),
  );
  const assetsByObjectId = new Map(
    ctx.sql
      .exec<{ object_id: string; asset_json: string | null; content_name: string | null }>(
        "SELECT object_id, asset_json, content_name FROM attachments WHERE status = 'done'",
      )
      .toArray()
      .flatMap((row) => {
        if (!row.asset_json) return [];
        return [[row.object_id, JSON.parse(row.asset_json) as ResolvedSourceAsset] as const];
      }),
  );
  const skippedObjectIds = new Set(
    ctx.sql
      .exec<{ object_id: string; content_name: string | null }>(
        "SELECT object_id, content_name FROM attachments WHERE status = 'skipped'",
      )
      .toArray()
      .map((row) => row.object_id),
  );
  const skippedNames = new Map(
    ctx.sql
      .exec<{ object_id: string; content_name: string | null }>(
        "SELECT object_id, content_name FROM attachments WHERE status = 'skipped'",
      )
      .toArray()
      .map((row) => [row.object_id, row.content_name ?? row.object_id] as const),
  );

  while (weeksDone < weeks.length) {
    if (!ctx.budget.canSpend(weekUnitCost)) return { phaseComplete: false };
    const week = weeks[weeksDone];
    if (!week) break;

    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(week.r2_key);
    if (!object) throw new Error(`Missing Chat import week object: ${week.r2_key}`);
    const body = (await object.json()) as { messages?: ChatMessage[] };
    const [normalized] = normalizeChatMessages(body.messages ?? [], {
      resolveSenderName: (sender) =>
        (sender?.name ? senderNames.get(sender.name) : undefined) ?? defaultSenderName(sender),
      threadParents,
    });
    if (!normalized) {
      weeksDone += 1;
      metaSet(ctx.sql, "weeks_done", String(weeksDone));
      continue;
    }

    let markdown = normalized.markdown;
    const metadata = mergeDocumentUrls(null, normalized.urls);
    const cursor = normalized.cursor;
    const path = pathForMediaType(normalized.path, MARKDOWN_MEDIA_TYPE);
    const assets: ResolvedSourceAsset[] = [];

    for (const item of normalized.attachments) {
      const asset = assetsByObjectId.get(item.objectId);
      if (asset) {
        assets.push(asset);
        markdown = markdown.replaceAll(`attachment:${item.objectId}`, asset.path);
        continue;
      }
      if (skippedObjectIds.has(item.objectId)) {
        const contentName = skippedNames.get(item.objectId) ?? item.contentName;
        markdown = markdown
          .replaceAll(`![${contentName}](attachment:${item.objectId})`, "")
          .replaceAll(`[${contentName}](attachment:${item.objectId})`, contentName);
      }
    }

    ctx.budget.spend(persistCost);
    await persistSourceDocument(ctx.env, {
      sourceId: current.source.id,
      fetchAttemptId: current.run.fetchAttemptId,
      path,
      title: normalized.title,
      body: markdownBody(markdown),
      mediaType: MARKDOWN_MEDIA_TYPE,
      cursor,
      metadata: metadata ?? JSON.stringify({ urls: normalized.urls }),
      assets,
      assetPolicy: incremental ? "merge" : "replace",
    });

    weeksDone += 1;
    metaSet(ctx.sql, "weeks_done", String(weeksDone));
  }

  if (weeksDone < weeks.length) return { phaseComplete: false };
  // The generic tick calls complete immediately after this step. Reserve its
  // archive/source/run writes (and incremental retained-path read) so a final
  // document persist cannot push the tick over the subrequest budget.
  const completeCost = ARCHIVE_MISSING_SUBREQUESTS + 2 + (incremental ? 1 : 0);
  return { phaseComplete: ctx.budget.canSpend(completeCost) };
}

export async function completeImport(ctx: ChatImportTickContext, current: Current): Promise<void> {
  const weeks = ctx.sql
    .exec<{ week_path: string }>("SELECT week_path FROM week_documents")
    .toArray()
    .map((row) => pathForMediaType(row.week_path, MARKDOWN_MEDIA_TYPE));

  const incremental = Boolean(current.run.sinceCursor);
  let retainedPaths = weeks;
  if (incremental) {
    ctx.budget.spend(1);
    const existing = await current.db
      .select({ path: schema.sourceDocuments.path })
      .from(schema.sourceDocuments)
      .where(
        and(
          eq(schema.sourceDocuments.sourceId, current.source.id),
          ne(schema.sourceDocuments.status, "archived"),
        ),
      )
      .all();
    retainedPaths = [...new Set([...existing.map((row) => row.path), ...weeks])];
  }

  ctx.budget.spend(ARCHIVE_MISSING_SUBREQUESTS);
  await archiveMissingDocuments(
    current.db,
    current.source.id,
    current.run.fetchAttemptId,
    retainedPaths,
  );

  ctx.budget.spend(1);
  await current.db
    .update(schema.sources)
    .set({
      status: "ready",
      fetchAttemptId: null,
      errorMessage: null,
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, current.source.id),
        eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
      ),
    );

  ctx.budget.spend(1);
  await current.db
    .update(schema.sourceImportRuns)
    .set({ phase: "complete", consecutiveFailures: 0, updatedAt: new Date() })
    .where(eq(schema.sourceImportRuns.id, ctx.runId));

  await deleteRunTempObjects(ctx, current.source.id);

  log("import_completed", {
    sourceId: current.source.id,
    runId: ctx.runId,
    pages: Number(metaGet(ctx.sql, "pages_fetched") ?? "0"),
    messages: Number(metaGet(ctx.sql, "messages_fetched") ?? "0"),
    weeks: weeks.length,
    subrequests: ctx.budget.spent,
  });
}

async function deleteRunTempObjects(ctx: ChatImportTickContext, sourceId: string): Promise<void> {
  const keys = [
    ...ctx.sql
      .exec<{ r2_key: string }>("SELECT r2_key FROM pages")
      .toArray()
      .map((r) => r.r2_key),
    ...ctx.sql
      .exec<{ r2_key: string }>("SELECT r2_key FROM week_documents")
      .toArray()
      .map((r) => r.r2_key),
  ];
  for (const key of keys) {
    if (!ctx.budget.canSpend(1)) break;
    ctx.budget.spend(1);
    try {
      await ctx.env.BUCKET.delete(key);
    } catch (error) {
      warnGoogleChat("temporary_object_cleanup_failed", {
        sourceId,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
}
