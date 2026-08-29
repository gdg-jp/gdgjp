import { and, eq, ne } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import {
  type DiscordMessage,
  listChannelMessages,
  parseDiscordChannelUrl,
  snowflakeFromUnixMs,
} from "../../../app/features/discord/api.server";
import { DISCORD_BOT_ACCESS_MESSAGE } from "../../../app/features/discord/oauth.server";
import { type ResolvedSourceAsset, assetR2Key } from "./assets";
import {
  discordAttachmentObjectId,
  mergeDocumentUrls,
  normalizeDiscordMessages,
  warnDiscord,
} from "./discord";
import { weekBoundsRfc3339, weekPathFromCreateTime } from "./google-chat";
import { archiveMissingDocuments } from "./import/archive";
import {
  ARCHIVE_MISSING_SUBREQUESTS,
  type CurrentSourceImport,
  PERSIST_MERGE_SUBREQUESTS,
  PERSIST_REPLACE_SUBREQUESTS,
  type SourceImportTickContext,
  metaGet,
  metaSet,
} from "./import/run";
import type { ImportKindDriver } from "./import/tick";
import { MARKDOWN_MEDIA_TYPE, markdownBody, pathForMediaType } from "./media-type";
import { persistSourceDocument, sha256Hex } from "./persist";
import { ATTACHMENT_PARALLELISM } from "./subrequest-budget";

export const DISCORD_PAGE_SIZE = 100;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type DiscordImportPhase =
  | "listing"
  | "attachments"
  | "grouping"
  | "finalizing"
  | "complete"
  | "error";

export type StepOutcome = { phaseComplete: boolean; continueAfterMs?: number };

type DiscordImportTickContext = SourceImportTickContext;
type Current = CurrentSourceImport;

function log(
  event: string,
  details: Record<string, string | number | boolean | undefined | null>,
): void {
  console.log(JSON.stringify({ component: "sources", integration: "discord", event, ...details }));
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function requireBotToken(ctx: DiscordImportTickContext): string {
  const token = ctx.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
  return token;
}

function channelIdOf(source: typeof schema.sources.$inferSelect): string {
  if (source.externalId) return source.externalId;
  const parsed = parseDiscordChannelUrl(source.url);
  if (!parsed) throw new Error("Discord source is missing a channel id");
  return parsed.channelId;
}

function indexMessage(sql: SqlStorage, message: DiscordMessage): void {
  if (!message.timestamp) return;
  const weekPath = weekPathFromCreateTime(message.timestamp);
  if (!weekPath) return;
  sql.exec(
    `INSERT INTO week_messages (week_path, thread_name, create_time, message_json)
     VALUES (?, ?, ?, ?)`,
    weekPath,
    message.id,
    message.timestamp,
    JSON.stringify(message),
  );
  for (const attachment of message.attachments ?? []) {
    const objectId = discordAttachmentObjectId(attachment);
    sql.exec(
      `INSERT OR IGNORE INTO attachments (
        message_name, object_id, drive_file_id, media_resource_name,
        content_type, content_name, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      message.id,
      objectId,
      null,
      attachment.url,
      attachment.content_type ?? null,
      attachment.filename || objectId,
    );
  }
}

async function stepListing(ctx: DiscordImportTickContext, current: Current): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "listing_complete") === "1") {
    if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
      return { phaseComplete: false };
    }
    return { phaseComplete: true };
  }

  const botToken = requireBotToken(ctx);
  const channelId = channelIdOf(current.source);
  const incremental = Boolean(current.run.sinceCursor);

  while (ctx.budget.canSpend(2)) {
    const pageIndex = Number(metaGet(ctx.sql, "pages_fetched") ?? "0");
    const cursorKey = incremental ? "after_message_id" : "before_message_id";
    const pageCursor = metaGet(ctx.sql, cursorKey);

    let messages: DiscordMessage[];
    try {
      ctx.budget.spend(1);
      if (incremental) {
        const after =
          pageCursor ?? (pageIndex === 0 ? (current.run.sinceCursor as string) : undefined);
        if (!after && pageIndex > 0) {
          metaSet(ctx.sql, "listing_complete", "1");
          break;
        }
        messages = await listChannelMessages(botToken, channelId, {
          limit: DISCORD_PAGE_SIZE,
          after: after ?? current.run.sinceCursor ?? undefined,
        });
        // Discord returns ascending when using `after`. Advance with the newest id.
        const newest = messages[messages.length - 1];
        if (newest) metaSet(ctx.sql, cursorKey, newest.id);
      } else {
        messages = await listChannelMessages(botToken, channelId, {
          limit: DISCORD_PAGE_SIZE,
          before: pageCursor ?? undefined,
        });
        // Discord returns descending when using `before`. Advance with the oldest id.
        const oldest = messages[messages.length - 1];
        if (oldest) metaSet(ctx.sql, cursorKey, oldest.id);
      }
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "bot_missing") throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
      throw error;
    }

    const r2Key = `raw/${current.source.id}/discord-runs/${ctx.runId}/pages/${pageIndex}.json`;
    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
      httpMetadata: { contentType: "application/json" },
    });
    ctx.sql.exec(
      `INSERT INTO pages (page_index, r2_key, message_count) VALUES (?, ?, ?)
       ON CONFLICT(page_index) DO UPDATE SET
         r2_key = excluded.r2_key, message_count = excluded.message_count`,
      pageIndex,
      r2Key,
      messages.length,
    );

    for (const message of messages) {
      if (incremental) {
        const weekPath = weekPathFromCreateTime(message.timestamp);
        if (weekPath) {
          ctx.sql.exec("INSERT OR IGNORE INTO touched_weeks (week_path) VALUES (?)", weekPath);
        }
      } else {
        indexMessage(ctx.sql, message);
      }
    }

    metaSet(ctx.sql, "pages_fetched", String(pageIndex + 1));
    metaSet(
      ctx.sql,
      "messages_fetched",
      String(Number(metaGet(ctx.sql, "messages_fetched") ?? "0") + messages.length),
    );
    log("page_stored", {
      sourceId: current.source.id,
      runId: ctx.runId,
      pageIndex,
      messages: messages.length,
      subrequests: ctx.budget.spent,
    });

    if (messages.length < DISCORD_PAGE_SIZE) {
      metaSet(ctx.sql, "listing_complete", "1");
      break;
    }
  }

  if (metaGet(ctx.sql, "listing_complete") !== "1") return { phaseComplete: false };
  if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

/** Re-fetch every delta-touched week so merge persists a complete weekly document. */
async function regenerateTouchedWeeks(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "weeks_regenerated") === "1") return true;
  const weeks = ctx.sql
    .exec<{ week_path: string }>("SELECT week_path FROM touched_weeks ORDER BY week_path")
    .toArray();
  let index = Number(metaGet(ctx.sql, "weeks_regenerate_index") ?? "0");
  const botToken = requireBotToken(ctx);
  const channelId = channelIdOf(current.source);

  while (index < weeks.length) {
    const weekPath = weeks[index]?.week_path;
    if (!weekPath) break;
    const startedKey = `week_regenerate_started:${weekPath}`;
    const afterKey = `week_regenerate_after:${weekPath}`;
    if (metaGet(ctx.sql, startedKey) !== "1") {
      ctx.sql.exec(
        `DELETE FROM attachments WHERE message_name IN (
           SELECT thread_name FROM week_messages WHERE week_path = ?
         )`,
        weekPath,
      );
      ctx.sql.exec("DELETE FROM week_messages WHERE week_path = ?", weekPath);
      metaSet(ctx.sql, startedKey, "1");
    }
    if (!ctx.budget.canSpend(1)) return false;

    const bounds = weekBoundsRfc3339(weekPath);
    if (!bounds) throw new Error(`Invalid Discord week path: ${weekPath}`);
    const after = metaGet(ctx.sql, afterKey) ?? snowflakeFromUnixMs(Date.parse(bounds.start) - 1);
    const before = snowflakeFromUnixMs(Date.parse(bounds.end));

    ctx.budget.spend(1);
    let messages: DiscordMessage[];
    try {
      messages = await listChannelMessages(botToken, channelId, {
        limit: DISCORD_PAGE_SIZE,
        after,
        before,
      });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "bot_missing") throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
      throw error;
    }

    for (const message of messages) {
      const messageWeek = weekPathFromCreateTime(message.timestamp);
      if (messageWeek !== weekPath) continue;
      indexMessage(ctx.sql, message);
    }

    if (messages.length >= DISCORD_PAGE_SIZE) {
      const newest = messages[messages.length - 1];
      if (newest) {
        metaSet(ctx.sql, afterKey, newest.id);
        continue;
      }
    }
    ctx.sql.exec("DELETE FROM meta WHERE key IN (?, ?)", startedKey, afterKey);
    index += 1;
    metaSet(ctx.sql, "weeks_regenerate_index", String(index));
  }
  metaSet(ctx.sql, "weeks_regenerated", "1");
  return true;
}

class AttachmentTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("Discord attachment exceeds the 10 MB limit");
  }
}

async function readAttachmentBytes(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError(byteLength);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function stepAttachments(
  ctx: DiscordImportTickContext,
  current: Current,
): Promise<StepOutcome> {
  while (true) {
    const pending = ctx.sql
      .exec<{
        id: number;
        object_id: string;
        media_resource_name: string | null;
        content_type: string | null;
        content_name: string | null;
      }>(
        `SELECT id, object_id, media_resource_name, content_type, content_name
         FROM attachments WHERE status = 'pending' ORDER BY id LIMIT ?`,
        ATTACHMENT_PARALLELISM,
      )
      .toArray();
    if (pending.length === 0) return { phaseComplete: true };

    const batchSize = Math.min(
      pending.length,
      Math.floor(ctx.budget.remaining() / 2),
      ATTACHMENT_PARALLELISM,
    );
    if (batchSize <= 0) return { phaseComplete: false };
    const batch = pending.slice(0, batchSize);

    await Promise.all(
      batch.map(async (row) => {
        const asset = await downloadAttachment(
          ctx,
          current.source.id,
          row.object_id,
          row.media_resource_name,
          row.content_type,
        );
        if (asset) {
          ctx.sql.exec(
            "UPDATE attachments SET status = 'done', asset_json = ? WHERE id = ?",
            JSON.stringify(asset),
            row.id,
          );
        } else {
          ctx.sql.exec("UPDATE attachments SET status = 'skipped' WHERE id = ?", row.id);
        }
      }),
    );
  }
}

async function downloadAttachment(
  ctx: DiscordImportTickContext,
  sourceId: string,
  objectId: string,
  url: string | null,
  contentType: string | null,
): Promise<ResolvedSourceAsset | null> {
  if (!url) return null;
  ctx.budget.spend(1);
  const response = await fetchWithTimeout(url, { headers: { "Accept-Encoding": "identity" } });
  if (response.status === 403 || response.status === 404) {
    warnDiscord("attachment_unavailable", {
      sourceId,
      attachmentId: objectId,
      status: response.status,
    });
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to download a Discord attachment (${response.status})`);
  }
  const declared = Number(response.headers.get("Content-Length") ?? Number.NaN);
  if (Number.isSafeInteger(declared) && declared > MAX_ATTACHMENT_BYTES) {
    warnDiscord("attachment_too_large", {
      sourceId,
      attachmentId: objectId,
      byteSize: declared,
    });
    return null;
  }
  if (!response.body) throw new Error("Discord attachment response has no body");
  let bytes: Uint8Array;
  try {
    bytes = await readAttachmentBytes(response.body);
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      warnDiscord("attachment_too_large", {
        sourceId,
        attachmentId: objectId,
        byteSize: error.byteSize,
      });
      return null;
    }
    throw error;
  }
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    contentType ||
    "application/octet-stream";
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256: contentHash, objectId },
  });
  return {
    path: r2Key,
    r2Key,
    mimeType,
    byteSize: bytes.byteLength,
    contentHash,
  };
}

async function stepGrouping(ctx: DiscordImportTickContext, current: Current): Promise<StepOutcome> {
  const weekPaths = ctx.sql
    .exec<{ week_path: string }>("SELECT DISTINCT week_path FROM week_messages ORDER BY week_path")
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
         WHERE week_path = ? ORDER BY create_time, id`,
        weekPath,
      )
      .toArray()
      .map((row) => JSON.parse(row.message_json) as DiscordMessage);
    const r2Key = `raw/${current.source.id}/discord-runs/${ctx.runId}/weeks/${weekPath}.json`;
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
  return { phaseComplete: true };
}

async function stepFinalizing(
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
    const [normalized] = normalizeDiscordMessages(body.messages ?? []);
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
      path: pathForMediaType(normalized.path, MARKDOWN_MEDIA_TYPE),
      title: normalized.title,
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

async function completeImport(ctx: DiscordImportTickContext, current: Current): Promise<void> {
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

async function deleteRunTempObjects(
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

export const discordImportDriver: ImportKindDriver<
  Exclude<DiscordImportPhase, "complete" | "error">
> = {
  kind: "discord-channel",
  phases: ["listing", "attachments", "grouping", "finalizing"],
  needsAccessToken: false,
  requiredScopes: [],
  async step(phase, ctx, current) {
    const discordCtx = ctx as DiscordImportTickContext;
    const discordCurrent = current as Current;
    if (phase === "listing") return stepListing(discordCtx, discordCurrent);
    if (phase === "attachments") return stepAttachments(discordCtx, discordCurrent);
    if (phase === "grouping") return stepGrouping(discordCtx, discordCurrent);
    return stepFinalizing(discordCtx, discordCurrent);
  },
  complete(ctx, current) {
    return completeImport(ctx as DiscordImportTickContext, current as Current);
  },
};
