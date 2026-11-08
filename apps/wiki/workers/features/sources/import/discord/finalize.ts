import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../../../app/db/schema";
import type { DiscordMessage } from "../../../../../app/features/discord/api.server";
import type { ResolvedSourceAsset } from "../../assets";
import { markdownLineCount, packNextDocument } from "../../chat-periods";
import { mergeDocumentUrls, normalizeDiscordMessages, warnDiscord } from "../../discord";
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
import { type Current, type DiscordImportTickContext, type StepOutcome, log } from "./shared";

/** Pack the indexed weeks into documents (`chat-periods.ts`), one R2 object each. */
export async function stepGrouping(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  const weekPaths = ctx.sql
    .exec<{ week_path: string }>("SELECT DISTINCT week_path FROM week_messages ORDER BY week_path")
    .toArray()
    .map((row) => row.week_path);
  const load = (weekPath: string) =>
    ctx.sql
      .exec<{ message_json: string }>(
        `SELECT message_json FROM week_messages
         WHERE week_path = ? ORDER BY create_time, id`,
        weekPath,
      )
      .toArray()
      .map((row) => JSON.parse(row.message_json) as DiscordMessage);
  const measure = (messages: DiscordMessage[]) =>
    markdownLineCount(
      normalizeDiscordMessages(messages, { singleDocument: true })[0]?.markdown ?? "",
    );

  let next = Number(metaGet(ctx.sql, "weeks_flush_index") ?? "0");
  while (next < weekPaths.length) {
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    const firstWeek = weekPaths[next];
    if (!firstWeek) break;
    const { messages, end } = packNextDocument(weekPaths, next, load, measure);
    const r2Key = `raw/${current.source.id}/discord-runs/${ctx.runId}/documents/${firstWeek}.json`;
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
      httpMetadata: { contentType: "application/json" },
    });
    // week_documents.week_path is the document's first week (its path).
    ctx.sql.exec(
      `INSERT INTO week_documents (week_path, r2_key, sort_index) VALUES (?, ?, ?)
       ON CONFLICT(week_path) DO UPDATE SET r2_key = excluded.r2_key, sort_index = excluded.sort_index`,
      firstWeek,
      r2Key,
      next,
    );
    next = end;
    metaSet(ctx.sql, "weeks_flush_index", String(next));
  }
  return { phaseComplete: true };
}

export async function stepFinalizing(
  ctx: DiscordImportTickContext,
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
  const weekUnitCost = 1 + persistCost;

  const assetsByObjectId = new Map(
    ctx.sql
      .exec<{ object_id: string; asset_json: string | null }>(
        "SELECT object_id, asset_json FROM attachments WHERE status = 'done'",
      )
      .toArray()
      .flatMap((row) => {
        if (!row.asset_json) return [];
        return [[row.object_id, JSON.parse(row.asset_json) as ResolvedSourceAsset] as const];
      }),
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
    if (!object) throw new Error(`Missing Discord import week object: ${week.r2_key}`);
    const body = (await object.json()) as { messages?: DiscordMessage[] };
    const [normalized] = normalizeDiscordMessages(body.messages ?? [], { singleDocument: true });
    if (!normalized) {
      weeksDone += 1;
      metaSet(ctx.sql, "weeks_done", String(weeksDone));
      continue;
    }

    let markdown = normalized.markdown;
    const assets: ResolvedSourceAsset[] = [];
    for (const item of normalized.attachments) {
      const asset = assetsByObjectId.get(item.objectId);
      if (asset) {
        assets.push(asset);
        markdown = markdown.replaceAll(`attachment:${item.objectId}`, asset.path);
        continue;
      }
      if (skippedNames.has(item.objectId)) {
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
      path: pathForMediaType(
        `${ctx.channelDocument?.pathPrefix ?? ""}${normalized.path}`,
        MARKDOWN_MEDIA_TYPE,
      ),
      title: `${ctx.channelDocument?.titlePrefix ?? ""}${normalized.title}`,
      body: markdownBody(markdown),
      mediaType: MARKDOWN_MEDIA_TYPE,
      cursor: normalized.cursor,
      metadata:
        mergeDocumentUrls(null, normalized.urls) ?? JSON.stringify({ urls: normalized.urls }),
      assets,
      assetPolicy: incremental ? "merge" : "replace",
    });

    weeksDone += 1;
    metaSet(ctx.sql, "weeks_done", String(weeksDone));
  }

  if (weeksDone < weeks.length) return { phaseComplete: false };
  const completeCost = ARCHIVE_MISSING_SUBREQUESTS + 2 + (incremental ? 1 : 0);
  return { phaseComplete: ctx.budget.canSpend(completeCost) };
}

export async function completeImport(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<void> {
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
    // The open document was rebuilt from its first week; drop it if no document starts there now.
    const replaced = metaGet(ctx.sql, "open_path");
    retainedPaths = [
      ...new Set([
        ...existing.map((row) => row.path).filter((path) => path !== replaced),
        ...weeks,
      ]),
    ];
  }

  ctx.budget.spend(ARCHIVE_MISSING_SUBREQUESTS);
  await archiveMissingDocuments(
    current.db,
    current.source.id,
    current.run.fetchAttemptId,
    retainedPaths,
    ctx.env.BUCKET,
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

export async function deleteRunTempObjects(
  ctx: DiscordImportTickContext,
  sourceId: string,
): Promise<void> {
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
      warnDiscord("temporary_object_cleanup_failed", {
        sourceId,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
