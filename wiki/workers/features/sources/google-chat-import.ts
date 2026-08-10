import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { REQUIRED_GOOGLE_CHAT_SCOPES, driveFilesUrl } from "../../../app/lib/google-drive.server";
import { type ResolvedSourceAsset, assetR2Key } from "./assets";
import { MAX_SENDER_SAMPLES, pruneSenderSamplesStatement } from "./chat-sender-registry";
import {
  type ChatMessage,
  type ChatMessageAttachment,
  GOOGLE_CHAT_REAUTH_MESSAGE,
  THREAD_PARENT_UNAVAILABLE,
  attachmentObjectId,
  defaultSenderName,
  fetchThreadParentText,
  logGoogleChatMessagesListError,
  mergeDocumentUrls,
  normalizeChatMessages,
  warnGoogleChat,
  weekBoundsRfc3339,
  weekPathFromCreateTime,
} from "./google-chat";
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

export const CHAT_PAGE_SIZE = 100;
const CHAT_TIMEOUT_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Unconfigured senders flushed to D1 per subrequest batch. */
export const SENDERS_FLUSH_BATCH_SIZE = 20;
export type ChatImportPhase =
  | "listing"
  | "indexing"
  | "senders"
  | "attachments"
  | "grouping"
  | "finalizing"
  | "complete"
  | "error";

export type StepOutcome = { phaseComplete: boolean };

type ChatImportTickContext = SourceImportTickContext;
type Current = CurrentSourceImport;

function log(
  event: string,
  details: Record<string, string | number | boolean | undefined | null>,
): void {
  console.log(
    JSON.stringify({ component: "sources", integration: "google-chat", event, ...details }),
  );
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function contentLength(response: Response): number | null {
  const value = response.headers.get("Content-Length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

class AttachmentTooLargeError extends Error {
  constructor(readonly byteSize: number) {
    super("Google Chat attachment exceeds the 10 MB limit");
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

function spaceNameOf(source: typeof schema.sources.$inferSelect): string {
  return source.externalId?.startsWith("spaces/")
    ? source.externalId
    : `spaces/${source.externalId}`;
}

function requireAccessToken(ctx: ChatImportTickContext): string {
  if (!ctx.accessToken) throw new Error("Chat import tick is missing a resolved access token");
  return ctx.accessToken;
}
async function stepListing(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "listing_complete") === "1") return { phaseComplete: true };

  const token = requireAccessToken(ctx);
  // fetch + R2 put; page cursors live in object-local SQLite meta.
  while (ctx.budget.canSpend(2)) {
    const spaceName = spaceNameOf(current.source);
    const params = new URLSearchParams({ pageSize: String(CHAT_PAGE_SIZE) });
    const pageToken = metaGet(ctx.sql, "next_page_token");
    if (pageToken) params.set("pageToken", pageToken);
    if (current.run.sinceCursor) params.set("filter", `createTime > "${current.run.sinceCursor}"`);

    ctx.budget.spend(1);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceName}/messages?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName,
        filter: current.run.sinceCursor ? `createTime > "${current.run.sinceCursor}"` : null,
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const messages = page.messages ?? [];
    const pageIndex = Number(metaGet(ctx.sql, "pages_fetched") ?? "0");
    const r2Key = `raw/${current.source.id}/chat-runs/${ctx.runId}/pages/${pageIndex}.json`;

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

    const nextToken = page.nextPageToken ?? null;
    if (nextToken) metaSet(ctx.sql, "next_page_token", nextToken);
    else ctx.sql.exec("DELETE FROM meta WHERE key = 'next_page_token'");
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

    if (!nextToken) {
      metaSet(ctx.sql, "listing_complete", "1");
      return { phaseComplete: true };
    }
  }
  return { phaseComplete: false };
}

function indexMessage(
  sql: SqlStorage,
  message: ChatMessage,
  fallbackName: string,
  expectedWeek?: string,
): void {
  if (!message.createTime) return;
  const weekPath = weekPathFromCreateTime(message.createTime);
  if (!weekPath || (expectedWeek && weekPath !== expectedWeek)) return;
  const messageName = message.name || fallbackName;
  const threadName = message.thread?.name || messageName;
  sql.exec(
    `INSERT INTO week_messages (week_path, thread_name, create_time, message_json)
     VALUES (?, ?, ?, ?)`,
    weekPath,
    threadName,
    message.createTime,
    JSON.stringify(message),
  );
  if (message.sender?.name) {
    sql.exec(
      "INSERT OR IGNORE INTO senders (resource_name, display_name) VALUES (?, NULL)",
      message.sender.name,
    );
    if (message.sender.type === "BOT") {
      sql.exec(
        "UPDATE senders SET display_name = 'Bot' WHERE resource_name = ? AND display_name IS NULL",
        message.sender.name,
      );
    }
    // Kept unpruned on purpose: stepSenders reads with LIMIT MAX_SENDER_SAMPLES, so
    // trimming here would cost a subquery per message to bound a table that is already
    // smaller than week_messages and wiped with it at the start of every run.
    const sampleText = (message.text ?? message.argumentText ?? "").trim();
    if (sampleText) {
      sql.exec(
        `INSERT INTO sender_samples (resource_name, message_name, create_time, message_text)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(resource_name, message_name) DO UPDATE SET
           create_time = excluded.create_time,
           message_text = excluded.message_text`,
        message.sender.name,
        messageName,
        message.createTime,
        sampleText,
      );
    }
  }
  if (message.thread?.name) {
    if (message.threadReply) {
      sql.exec("INSERT OR IGNORE INTO reply_threads (thread_name) VALUES (?)", message.thread.name);
    } else {
      const parent = (message.text ?? message.argumentText ?? "").trim();
      if (parent) {
        sql.exec(
          "INSERT OR IGNORE INTO thread_parents (thread_name, parent_text) VALUES (?, ?)",
          message.thread.name,
          parent,
        );
      }
    }
  }
  for (const [attachmentIndex, attachment] of (message.attachment ?? []).entries()) {
    const objectId = attachmentObjectId(attachment, attachmentIndex);
    sql.exec(
      `INSERT OR IGNORE INTO attachments (
        message_name, object_id, drive_file_id, media_resource_name,
        content_type, content_name, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      messageName,
      objectId,
      attachment.driveDataRef?.driveFileId ?? null,
      attachment.attachmentDataRef?.resourceName ?? null,
      attachment.contentType ?? null,
      attachment.contentName ?? objectId,
    );
  }
}

async function stepIndexing(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  const pages = ctx.sql
    .exec<{ page_index: number; r2_key: string }>(
      "SELECT page_index, r2_key FROM pages ORDER BY page_index",
    )
    .toArray();
  let pageCursor = Number(metaGet(ctx.sql, "indexing_page") ?? "0");
  while (pageCursor < pages.length) {
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    const page = pages[pageCursor];
    if (!page) break;
    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(page.r2_key);
    if (!object) throw new Error(`Missing Chat import page object: ${page.r2_key}`);
    const body = (await object.json()) as { messages?: ChatMessage[] };
    for (const [messageIndex, message] of (body.messages ?? []).entries()) {
      if (current.run.sinceCursor) {
        if (!message.createTime) continue;
        const weekPath = weekPathFromCreateTime(message.createTime);
        if (weekPath) {
          ctx.sql.exec("INSERT OR IGNORE INTO touched_weeks (week_path) VALUES (?)", weekPath);
        }
      } else {
        indexMessage(ctx.sql, message, `unnamed-${page.page_index}-${messageIndex}`);
      }
    }
    pageCursor += 1;
    metaSet(ctx.sql, "indexing_page", String(pageCursor));
  }
  if (current.run.sinceCursor && !(await regenerateTouchedWeeks(ctx, current))) {
    return { phaseComplete: false };
  }
  return { phaseComplete: true };
}

async function stepSenders(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
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

async function stepAttachments(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  const token = requireAccessToken(ctx);

  while (true) {
    const pending = ctx.sql
      .exec<{
        id: number;
        object_id: string;
        drive_file_id: string | null;
        media_resource_name: string | null;
        content_type: string | null;
        content_name: string | null;
      }>(
        `SELECT id, object_id, drive_file_id, media_resource_name, content_type, content_name
         FROM attachments WHERE status = 'pending' ORDER BY id LIMIT ?`,
        ATTACHMENT_PARALLELISM,
      )
      .toArray();
    if (pending.length === 0) return { phaseComplete: true };

    // 2 subrequests per attachment; progress is object-local.
    const batchSize = Math.min(
      pending.length,
      Math.floor(ctx.budget.remaining() / 2),
      ATTACHMENT_PARALLELISM,
    );
    if (batchSize <= 0) return { phaseComplete: false };
    const batch = pending.slice(0, batchSize);

    await Promise.all(
      batch.map(async (row) => {
        const attachment: ChatMessageAttachment = {
          contentName: row.content_name ?? row.object_id,
          contentType: row.content_type ?? undefined,
          driveDataRef: row.drive_file_id ? { driveFileId: row.drive_file_id } : undefined,
          attachmentDataRef: row.media_resource_name
            ? { resourceName: row.media_resource_name }
            : undefined,
        };
        const asset = await downloadAttachment(
          ctx,
          current.source.id,
          token,
          row.object_id,
          attachment,
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

    const done = ctx.sql
      .exec<{ c: number }>(
        "SELECT COUNT(*) AS c FROM attachments WHERE status IN ('done', 'skipped')",
      )
      .one().c;
    metaSet(ctx.sql, "attachments_done", String(done));
  }
}

async function downloadAttachment(
  ctx: ChatImportTickContext,
  sourceId: string,
  token: string,
  objectId: string,
  attachment: ChatMessageAttachment,
): Promise<ResolvedSourceAsset | null> {
  const driveId = attachment.driveDataRef?.driveFileId;
  const media = attachment.attachmentDataRef?.resourceName;
  if (!driveId && !media) return null;
  const url = driveId
    ? driveFilesUrl(driveId, { alt: "media" })
    : `https://chat.googleapis.com/v1/media/${media}?alt=media`;

  ctx.budget.spend(1);
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "identity" },
  });
  if (response.status === 403 || response.status === 404) {
    warnGoogleChat("attachment_unavailable", {
      sourceId,
      attachmentId: objectId,
      attachmentKind: driveId ? "drive" : "chat-media",
      status: response.status,
    });
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to download a Google Chat attachment (${response.status})`);
  }
  const declaredByteSize = contentLength(response);
  if (declaredByteSize === null) {
    warnGoogleChat("attachment_size_unknown", {
      sourceId,
      attachmentId: objectId,
    });
    return null;
  }
  if (declaredByteSize > MAX_ATTACHMENT_BYTES) {
    warnGoogleChat("attachment_too_large", {
      sourceId,
      attachmentId: objectId,
      byteSize: declaredByteSize,
    });
    return null;
  }
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    attachment.contentType ||
    "application/octet-stream";
  if (!response.body) throw new Error("Google Chat attachment response has no body");
  let bytes: Uint8Array;
  try {
    bytes = await readAttachmentBytes(response.body);
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) {
      warnGoogleChat("attachment_too_large", {
        sourceId,
        attachmentId: objectId,
        byteSize: error.byteSize,
      });
      return null;
    }
    throw error;
  }
  if (bytes.byteLength !== declaredByteSize) {
    throw new Error("Google Chat attachment Content-Length does not match its body");
  }
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256: contentHash, objectId },
  });
  return { path: r2Key, r2Key, mimeType, byteSize: declaredByteSize, contentHash };
}

async function stepGrouping(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
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

/** Re-fetch and index every delta-touched week before sender/attachment processing. */
async function regenerateTouchedWeeks(
  ctx: ChatImportTickContext,
  current: Current,
): Promise<boolean> {
  if (metaGet(ctx.sql, "weeks_regenerated") === "1") return true;
  const weeks = ctx.sql
    .exec<{ week_path: string }>("SELECT week_path FROM touched_weeks ORDER BY week_path")
    .toArray();
  let index = Number(metaGet(ctx.sql, "weeks_regenerate_index") ?? "0");
  while (index < weeks.length) {
    const weekPath = weeks[index]?.week_path;
    if (!weekPath) break;
    const startedKey = `week_regenerate_started:${weekPath}`;
    const tokenKey = `week_regenerate_token:${weekPath}`;
    const pageKey = `week_regenerate_page:${weekPath}`;
    if (metaGet(ctx.sql, startedKey) !== "1") {
      ctx.sql.exec("DELETE FROM week_messages WHERE week_path = ?", weekPath);
      metaSet(ctx.sql, startedKey, "1");
    }
    if (!ctx.budget.canSpend(1)) return false;
    const bounds = weekBoundsRfc3339(weekPath);
    if (!bounds) throw new Error(`Invalid Chat week path: ${weekPath}`);
    const params = new URLSearchParams({
      pageSize: String(CHAT_PAGE_SIZE),
      filter: `createTime >= \"${bounds.start}\" AND createTime < \"${bounds.end}\"`,
    });
    const pageToken = metaGet(ctx.sql, tokenKey);
    if (pageToken) params.set("pageToken", pageToken);
    ctx.budget.spend(1);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceNameOf(current.source)}/messages?${params}`,
      { headers: { Authorization: `Bearer ${requireAccessToken(ctx)}` } },
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName: spaceNameOf(current.source),
        filter: params.get("filter"),
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat weekly messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const pageIndex = Number(metaGet(ctx.sql, pageKey) ?? "0");
    for (const [messageIndex, message] of (page.messages ?? []).entries()) {
      indexMessage(ctx.sql, message, `week-${index}-${pageIndex}-${messageIndex}`, weekPath);
    }
    if (page.nextPageToken) {
      metaSet(ctx.sql, tokenKey, page.nextPageToken);
      metaSet(ctx.sql, pageKey, String(pageIndex + 1));
      continue;
    }
    ctx.sql.exec("DELETE FROM meta WHERE key IN (?, ?, ?)", startedKey, tokenKey, pageKey);
    index += 1;
    metaSet(ctx.sql, "weeks_regenerate_index", String(index));
  }
  metaSet(ctx.sql, "weeks_regenerated", "1");
  return true;
}

async function stepFinalizing(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
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

async function completeImport(ctx: ChatImportTickContext, current: Current): Promise<void> {
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

/**
 * Chat's existing phase workers are a driver too. Keeping them as a driver
 * removes the Queue/DO kind fork while preserving each phase's established
 * subrequest accounting during the extraction to import/chat/.
 */
export const chatImportDriver: ImportKindDriver<Exclude<ChatImportPhase, "complete" | "error">> = {
  kind: "google-chat-space",
  phases: ["listing", "indexing", "senders", "attachments", "grouping", "finalizing"],
  needsAccessToken: true,
  requiredScopes: REQUIRED_GOOGLE_CHAT_SCOPES,
  authorizationErrorMessage: GOOGLE_CHAT_REAUTH_MESSAGE,
  async step(phase, ctx, current) {
    const chatCtx = ctx as ChatImportTickContext;
    const chatCurrent = current as Current;
    if (phase === "listing") return stepListing(chatCtx, chatCurrent);
    if (phase === "indexing") return stepIndexing(chatCtx, chatCurrent);
    if (phase === "senders") return stepSenders(chatCtx, chatCurrent);
    if (phase === "attachments") return stepAttachments(chatCtx, chatCurrent);
    if (phase === "grouping") return stepGrouping(chatCtx, chatCurrent);
    return stepFinalizing(chatCtx, chatCurrent);
  },
  complete(ctx, current) {
    return completeImport(ctx as ChatImportTickContext, current as Current);
  },
};

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
