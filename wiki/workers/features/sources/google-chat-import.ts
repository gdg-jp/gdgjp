import { and, eq, max, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import { getGoogleDriveTokenRow } from "../../../app/lib/google-drive-token.server";
import { hasRequiredGoogleChatScopes } from "../../../app/lib/google-drive.server";
import { type ResolvedSourceAsset, assetR2Key } from "./assets";
import {
  type ChatMessage,
  type ChatMessageAttachment,
  GOOGLE_CHAT_REAUTH_MESSAGE,
  THREAD_PARENT_UNAVAILABLE,
  appendMonthlyMarkdown,
  attachmentObjectId,
  defaultSenderName,
  fetchThreadParentText,
  logGoogleChatMessagesListError,
  mergeDocumentUrls,
  monthPathFromCreateTime,
  normalizeChatMessages,
  resolvePeopleDisplayNames,
  resolveSpaceMemberDisplayNames,
  warnGoogleChat,
} from "./google-chat";
import { ensureChatImportDoSchema } from "./google-chat-import-do-store";
import { archiveMissingDocuments } from "./google-chat-import-private";
import { persistSourceDocument, sha256Hex } from "./persist";
import { isRetryableFetchError } from "./retry-classification";
import {
  ATTACHMENT_PARALLELISM,
  SUBREQUEST_BUDGET_LIMIT,
  type SubrequestBudget,
} from "./subrequest-budget";

export const CHAT_PAGE_SIZE = 1000;
const CHAT_TIMEOUT_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const ALARM_CONTINUE_MS = 500;

/** D1 reads inside `currentRun` (run row + source lease row). */
export const CURRENT_RUN_SUBREQUESTS = 2;
/** D1 read inside `getGoogleDriveTokenRow` (refresh may add more; soft cap leaves headroom). */
export const ACCESS_TOKEN_SUBREQUESTS = 1;
/** Worst-case `persistSourceDocument` with `assetPolicy: "replace"`. */
export const PERSIST_REPLACE_SUBREQUESTS = 4;
/** Worst-case `persistSourceDocument` with `assetPolicy: "merge"`. */
export const PERSIST_MERGE_SUBREQUESTS = 5;
/** `archiveMissingDocuments`: lease check + update + lease re-check. */
export const ARCHIVE_MISSING_SUBREQUESTS = 3;

export type ChatImportPhase =
  | "listing"
  | "senders"
  | "attachments"
  | "grouping"
  | "finalizing"
  | "complete"
  | "error";

export type StepOutcome = { phaseComplete: boolean };

export interface ChatImportTickContext {
  env: Env;
  sql: SqlStorage;
  budget: SubrequestBudget;
  runId: string;
  /** Resolved once per tick and passed into steps (never re-fetched in a loop). */
  accessToken?: string;
}

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

export async function currentRun(env: Env, runId: string) {
  const db = getDb(env);
  const run = await db
    .select()
    .from(schema.googleChatImportRuns)
    .where(eq(schema.googleChatImportRuns.id, runId))
    .get();
  if (!run) return null;
  const source = await db
    .select()
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.id, run.sourceId),
        eq(schema.sources.fetchAttemptId, run.fetchAttemptId),
        eq(schema.sources.status, "fetching"),
      ),
    )
    .get();
  return source ? { db, run, source } : null;
}

async function accessToken(env: Env, source: typeof schema.sources.$inferSelect): Promise<string> {
  const token = await getGoogleDriveTokenRow(env, getDb(env), source.addedBy);
  if (!hasRequiredGoogleChatScopes(token.grantedScopes))
    throw new Error(GOOGLE_CHAT_REAUTH_MESSAGE);
  return token.accessToken;
}

function spaceNameOf(source: typeof schema.sources.$inferSelect): string {
  return source.externalId?.startsWith("spaces/")
    ? source.externalId
    : `spaces/${source.externalId}`;
}

async function maxSourceCursor(env: Env, sourceId: string): Promise<string | null> {
  const db = getDb(env);
  const row = await db
    .select({ cursor: max(schema.sourceDocuments.cursor) })
    .from(schema.sourceDocuments)
    .where(
      and(
        eq(schema.sourceDocuments.sourceId, sourceId),
        ne(schema.sourceDocuments.status, "archived"),
      ),
    )
    .get();
  return row?.cursor ?? null;
}

function metaGet(sql: SqlStorage, key: string): string | null {
  const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0];
  return row?.value ?? null;
}

function metaSet(sql: SqlStorage, key: string, value: string): void {
  sql.exec(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

/** Starts a run and hands continuation to the per-source Durable Object. */
export async function startGoogleChatImport(
  env: Env,
  source: typeof schema.sources.$inferSelect,
  fetchAttemptId: string,
): Promise<boolean> {
  const db = getDb(env);
  const id = nanoid();
  const sinceCursor = await maxSourceCursor(env, source.id);
  // Claim the source and create its durable run in one transaction. A Queue retry
  // must never observe status="fetching" without the matching run. Replacing a
  // refresh deletes the old run so its child work is removed by the FK cascade.
  await db.batch([
    db
      .update(schema.sources)
      .set({
        status: "fetching",
        fetchAttemptId,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.sources.id, source.id), ne(schema.sources.status, "archived"))),
    db
      .delete(schema.googleChatImportRuns)
      .where(eq(schema.googleChatImportRuns.sourceId, source.id)),
    db.insert(schema.googleChatImportRuns).values({
      id,
      sourceId: source.id,
      fetchAttemptId,
      sinceCursor,
    }),
  ]);
  const current = await currentRun(env, id);
  if (!current) {
    await db.delete(schema.googleChatImportRuns).where(eq(schema.googleChatImportRuns.id, id));
    return false;
  }
  // Validate access only after the durable lease exists. If this throws, fetchSource
  // records the source error; a later refresh atomically replaces this run.
  await accessToken(env, current.source);
  await env.CHAT_IMPORT_DO.getByName(source.id).start(id);
  log("import_started", {
    sourceId: source.id,
    runId: id,
    incremental: Boolean(sinceCursor),
    subrequestBudget: SUBREQUEST_BUDGET_LIMIT,
  });
  return true;
}

export async function advanceChatImportTick(ctx: ChatImportTickContext): Promise<{
  finished: boolean;
  phase: ChatImportPhase;
  subrequests: number;
}> {
  if (!ctx.budget.canSpend(CURRENT_RUN_SUBREQUESTS)) {
    return { finished: false, phase: "listing", subrequests: ctx.budget.spent };
  }
  ctx.budget.spend(CURRENT_RUN_SUBREQUESTS);
  const current = await currentRun(ctx.env, ctx.runId);
  if (!current) {
    return { finished: true, phase: "complete", subrequests: ctx.budget.spent };
  }

  ensureChatImportDoSchema(ctx.sql);

  const pendingPhase = metaGet(ctx.sql, "pending_phase") as ChatImportPhase | null;
  if (pendingPhase && pendingPhase !== current.run.phase) {
    if (!ctx.budget.canSpend(1)) {
      return {
        finished: false,
        phase: current.run.phase as ChatImportPhase,
        subrequests: ctx.budget.spent,
      };
    }
    await commitPhase(ctx, current, pendingPhase);
  }

  if (!ctx.budget.canSpend(ACCESS_TOKEN_SUBREQUESTS)) {
    return {
      finished: false,
      phase: current.run.phase as ChatImportPhase,
      subrequests: ctx.budget.spent,
    };
  }
  ctx.budget.spend(ACCESS_TOKEN_SUBREQUESTS);
  ctx.accessToken = await accessToken(ctx.env, current.source);

  let phase = current.run.phase as ChatImportPhase;

  while (ctx.budget.remaining() > 0) {
    if (phase === "complete" || phase === "error") {
      return { finished: true, phase, subrequests: ctx.budget.spent };
    }

    const outcome =
      phase === "listing"
        ? await stepListing(ctx, current)
        : phase === "senders"
          ? await stepSenders(ctx, current)
          : phase === "attachments"
            ? await stepAttachments(ctx, current)
            : phase === "grouping"
              ? await stepGrouping(ctx, current)
              : await stepFinalizing(ctx, current);

    if (!outcome.phaseComplete) {
      return { finished: false, phase, subrequests: ctx.budget.spent };
    }

    const next: ChatImportPhase =
      phase === "listing"
        ? "senders"
        : phase === "senders"
          ? "attachments"
          : phase === "attachments"
            ? "grouping"
            : phase === "grouping"
              ? "finalizing"
              : "complete";

    if (next === "complete") {
      await completeImport(ctx, current);
      return { finished: true, phase: next, subrequests: ctx.budget.spent };
    }

    if (!ctx.budget.canSpend(1)) {
      metaSet(ctx.sql, "pending_phase", next);
      return { finished: false, phase, subrequests: ctx.budget.spent };
    }
    await commitPhase(ctx, current, next);
    phase = next;
  }

  return { finished: false, phase, subrequests: ctx.budget.spent };
}

type Current = NonNullable<Awaited<ReturnType<typeof currentRun>>>;

async function commitPhase(
  ctx: ChatImportTickContext,
  current: Current,
  phase: ChatImportPhase,
): Promise<void> {
  ctx.budget.spend(1);
  await current.db
    .update(schema.googleChatImportRuns)
    .set({ phase, updatedAt: new Date() })
    .where(eq(schema.googleChatImportRuns.id, ctx.runId));
  current.run.phase = phase;
  ctx.sql.exec("DELETE FROM meta WHERE key = ?", "pending_phase");
}

function requireAccessToken(ctx: ChatImportTickContext): string {
  if (!ctx.accessToken) throw new Error("Chat import tick is missing a resolved access token");
  return ctx.accessToken;
}
async function stepListing(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  if (metaGet(ctx.sql, "listing_complete") === "1") return { phaseComplete: true };

  const token = requireAccessToken(ctx);
  // fetch + R2 put + D1 run update
  while (ctx.budget.canSpend(3)) {
    const spaceName = spaceNameOf(current.source);
    const params = new URLSearchParams({ pageSize: String(CHAT_PAGE_SIZE) });
    if (current.run.nextPageToken) params.set("pageToken", current.run.nextPageToken);
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
        hasPageToken: Boolean(current.run.nextPageToken),
      });
      throw new Error(`Google Chat messages.list failed (${response.status})`);
    }
    const page = (await response.json()) as { messages?: ChatMessage[]; nextPageToken?: string };
    const messages = page.messages ?? [];
    const pageIndex = current.run.pagesFetched;
    const r2Key = `raw/${current.source.id}/chat-runs/${ctx.runId}/pages/${pageIndex}.json`;

    ctx.budget.spend(1);
    await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
      httpMetadata: { contentType: "application/json" },
    });

    ctx.sql.exec(
      "INSERT INTO pages (page_index, r2_key, message_count) VALUES (?, ?, ?)",
      pageIndex,
      r2Key,
      messages.length,
    );

    let attachmentIndex = 0;
    for (const [messageIndex, message] of messages.entries()) {
      const messageName = message.name || `unnamed-${pageIndex}-${messageIndex}`;
      if (message.sender?.name) {
        ctx.sql.exec(
          "INSERT OR IGNORE INTO senders (resource_name, display_name) VALUES (?, NULL)",
          message.sender.name,
        );
        if (message.sender.type === "BOT") {
          ctx.sql.exec(
            "UPDATE senders SET display_name = ? WHERE resource_name = ? AND display_name IS NULL",
            "Bot",
            message.sender.name,
          );
        }
      }
      if (message.thread?.name) {
        if (message.threadReply) {
          ctx.sql.exec(
            "INSERT OR IGNORE INTO reply_threads (thread_name) VALUES (?)",
            message.thread.name,
          );
        } else {
          const parent = (message.text ?? message.argumentText ?? "").trim();
          if (parent) {
            ctx.sql.exec(
              "INSERT OR IGNORE INTO thread_parents (thread_name, parent_text) VALUES (?, ?)",
              message.thread.name,
              parent,
            );
          }
        }
      }
      for (const attachment of message.attachment ?? []) {
        const objectId = attachmentObjectId(attachment, attachmentIndex++);
        ctx.sql.exec(
          `INSERT INTO attachments (
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

    const nextToken = page.nextPageToken ?? null;
    ctx.budget.spend(1);
    await current.db
      .update(schema.googleChatImportRuns)
      .set({
        nextPageToken: nextToken,
        pagesFetched: current.run.pagesFetched + 1,
        messagesFetched: current.run.messagesFetched + messages.length,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleChatImportRuns.id, ctx.runId));

    current.run.nextPageToken = nextToken;
    current.run.pagesFetched += 1;
    current.run.messagesFetched += messages.length;

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

async function stepSenders(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  const unresolved = ctx.sql
    .exec<{ resource_name: string }>("SELECT resource_name FROM senders WHERE display_name IS NULL")
    .toArray();
  if (unresolved.length === 0 && metaGet(ctx.sql, "members_done") === "1") {
    return { phaseComplete: true };
  }

  const token = requireAccessToken(ctx);
  const spaceName = spaceNameOf(current.source);

  if (metaGet(ctx.sql, "members_done") !== "1") {
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    const members = await resolveSpaceMemberDisplayNames(spaceName, token, {
      onFetch: () => ctx.budget.spend(1),
    });
    for (const [resourceName, displayName] of members) {
      ctx.sql.exec(
        "UPDATE senders SET display_name = ? WHERE resource_name = ? AND display_name IS NULL",
        displayName,
        resourceName,
      );
    }
    metaSet(ctx.sql, "members_done", "1");
  }

  const stillUnresolved = ctx.sql
    .exec<{ resource_name: string }>("SELECT resource_name FROM senders WHERE display_name IS NULL")
    .toArray();
  if (stillUnresolved.length === 0) return { phaseComplete: true };

  if (!ctx.budget.canSpend(1)) return { phaseComplete: false };

  const senders = stillUnresolved.map((row) => ({
    name: row.resource_name,
    type: "HUMAN" as const,
  }));
  const names = await resolvePeopleDisplayNames(token, senders, {
    onFetch: () => ctx.budget.spend(1),
  });
  for (const [resourceName, displayName] of names) {
    ctx.sql.exec(
      "UPDATE senders SET display_name = ? WHERE resource_name = ?",
      displayName,
      resourceName,
    );
  }
  ctx.sql.exec(
    "UPDATE senders SET display_name = 'Unknown user (' || resource_name || ')' WHERE display_name IS NULL",
  );
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

    // 2 subrequests per attachment + 1 D1 progress update
    const batchSize = Math.min(
      pending.length,
      Math.floor((ctx.budget.remaining() - 1) / 2),
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
    ctx.budget.spend(1);
    await current.db
      .update(schema.googleChatImportRuns)
      .set({ attachmentsDone: done, updatedAt: new Date() })
      .where(eq(schema.googleChatImportRuns.id, ctx.runId));
    current.run.attachmentsDone = done;
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
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`
    : `https://chat.googleapis.com/v1/media/${media}?alt=media`;

  ctx.budget.spend(1);
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
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
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    warnGoogleChat("attachment_too_large", {
      sourceId,
      attachmentId: objectId,
      byteSize: bytes.byteLength,
    });
    return null;
  }
  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    attachment.contentType ||
    "application/octet-stream";
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  ctx.budget.spend(1);
  await ctx.env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sha256: contentHash, objectId },
  });
  return { path: r2Key, r2Key, mimeType, byteSize: bytes.byteLength, contentHash };
}

async function stepGrouping(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  const pages = ctx.sql
    .exec<{ page_index: number; r2_key: string }>(
      "SELECT page_index, r2_key FROM pages ORDER BY page_index",
    )
    .toArray();
  let pageCursor = Number(metaGet(ctx.sql, "grouping_page") ?? "0");

  while (pageCursor < pages.length) {
    if (!ctx.budget.canSpend(1)) {
      metaSet(ctx.sql, "grouping_page", String(pageCursor));
      return { phaseComplete: false };
    }
    const page = pages[pageCursor];
    if (!page) break;
    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(page.r2_key);
    if (!object) throw new Error(`Missing Chat import page object: ${page.r2_key}`);
    const body = (await object.json()) as { messages?: ChatMessage[] };
    for (const message of body.messages ?? []) {
      if (!message.createTime) continue;
      const path = monthPathFromCreateTime(message.createTime);
      if (!path) continue;
      ctx.sql.exec(
        "INSERT INTO month_messages (month_path, message_json) VALUES (?, ?)",
        path,
        JSON.stringify(message),
      );
    }
    pageCursor += 1;
  }
  metaSet(ctx.sql, "grouping_page", String(pageCursor));

  if (metaGet(ctx.sql, "months_flushed") !== "1") {
    const monthPaths = ctx.sql
      .exec<{ month_path: string }>(
        "SELECT DISTINCT month_path FROM month_messages ORDER BY month_path",
      )
      .toArray();
    let sortIndex = Number(metaGet(ctx.sql, "months_flush_index") ?? "0");
    while (sortIndex < monthPaths.length) {
      // R2 put + D1 monthsTotal update charged once after the loop; per month only R2.
      if (!ctx.budget.canSpend(1)) {
        metaSet(ctx.sql, "months_flush_index", String(sortIndex));
        return { phaseComplete: false };
      }
      const monthPath = monthPaths[sortIndex]?.month_path;
      if (!monthPath) break;
      const messages = ctx.sql
        .exec<{ message_json: string }>(
          "SELECT message_json FROM month_messages WHERE month_path = ? ORDER BY id",
          monthPath,
        )
        .toArray()
        .map((row) => JSON.parse(row.message_json) as ChatMessage);
      const r2Key = `raw/${current.source.id}/chat-runs/${ctx.runId}/months/${monthPath}.json`;
      ctx.budget.spend(1);
      await ctx.env.BUCKET.put(r2Key, JSON.stringify({ messages }), {
        httpMetadata: { contentType: "application/json" },
      });
      ctx.sql.exec(
        "INSERT INTO months (month_path, r2_key, sort_index) VALUES (?, ?, ?) ON CONFLICT(month_path) DO UPDATE SET r2_key = excluded.r2_key, sort_index = excluded.sort_index",
        monthPath,
        r2Key,
        sortIndex,
      );
      sortIndex += 1;
      metaSet(ctx.sql, "months_flush_index", String(sortIndex));
    }
    if (!ctx.budget.canSpend(1)) return { phaseComplete: false };
    ctx.budget.spend(1);
    await current.db
      .update(schema.googleChatImportRuns)
      .set({ monthsTotal: monthPaths.length, updatedAt: new Date() })
      .where(eq(schema.googleChatImportRuns.id, ctx.runId));
    current.run.monthsTotal = monthPaths.length;
    metaSet(ctx.sql, "months_flushed", "1");
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

async function stepFinalizing(ctx: ChatImportTickContext, current: Current): Promise<StepOutcome> {
  const months = ctx.sql
    .exec<{ month_path: string; r2_key: string; sort_index: number }>(
      "SELECT month_path, r2_key, sort_index FROM months ORDER BY sort_index",
    )
    .toArray();
  let monthsDone = current.run.monthsDone;
  const incremental = Boolean(current.run.sinceCursor);
  const persistCost = incremental ? PERSIST_MERGE_SUBREQUESTS : PERSIST_REPLACE_SUBREQUESTS;
  // R2 get month + optional existing select + optional prior R2 get + persist + run update
  const monthUnitCost = 1 + (incremental ? 2 : 0) + persistCost + 1;

  const senderNames = new Map(
    ctx.sql
      .exec<{ resource_name: string; display_name: string | null }>(
        "SELECT resource_name, display_name FROM senders",
      )
      .toArray()
      .map(
        (row) =>
          [
            row.resource_name,
            row.display_name ?? defaultSenderName({ name: row.resource_name }),
          ] as const,
      ),
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

  while (monthsDone < months.length) {
    if (!ctx.budget.canSpend(monthUnitCost)) return { phaseComplete: false };
    const month = months[monthsDone];
    if (!month) break;

    ctx.budget.spend(1);
    const object = await ctx.env.BUCKET.get(month.r2_key);
    if (!object) throw new Error(`Missing Chat import month object: ${month.r2_key}`);
    const body = (await object.json()) as { messages?: ChatMessage[] };
    const [normalized] = normalizeChatMessages(body.messages ?? [], {
      resolveSenderName: (sender) =>
        sender?.name
          ? senderNames.get(sender.name) || defaultSenderName(sender)
          : defaultSenderName(sender),
      threadParents,
    });
    if (!normalized) {
      monthsDone += 1;
      ctx.budget.spend(1);
      await current.db
        .update(schema.googleChatImportRuns)
        .set({ monthsDone, updatedAt: new Date() })
        .where(eq(schema.googleChatImportRuns.id, ctx.runId));
      current.run.monthsDone = monthsDone;
      continue;
    }

    let markdown = normalized.markdown;
    let metadata = mergeDocumentUrls(null, normalized.urls);
    let cursor = normalized.cursor;
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

    if (incremental) {
      ctx.budget.spend(1);
      const existing = await current.db
        .select({
          r2Key: schema.sourceDocuments.r2Key,
          metadata: schema.sourceDocuments.metadata,
          cursor: schema.sourceDocuments.cursor,
          status: schema.sourceDocuments.status,
        })
        .from(schema.sourceDocuments)
        .where(
          and(
            eq(schema.sourceDocuments.sourceId, current.source.id),
            eq(schema.sourceDocuments.path, normalized.path),
          ),
        )
        .get();
      if (existing && existing.status !== "archived") {
        ctx.budget.spend(1);
        const previousObject = await ctx.env.BUCKET.get(existing.r2Key);
        const previousMarkdown = previousObject ? await previousObject.text() : "";
        markdown = appendMonthlyMarkdown(previousMarkdown, markdown);
        metadata = mergeDocumentUrls(existing.metadata, normalized.urls);
        if (existing.cursor && (!cursor || existing.cursor > cursor)) cursor = existing.cursor;
      }
    }

    ctx.budget.spend(persistCost);
    await persistSourceDocument(ctx.env, {
      sourceId: current.source.id,
      fetchAttemptId: current.run.fetchAttemptId,
      path: normalized.path,
      title: normalized.title,
      markdown,
      cursor,
      metadata: metadata ?? JSON.stringify({ urls: normalized.urls }),
      assets,
      assetPolicy: incremental ? "merge" : "replace",
    });

    monthsDone += 1;
    ctx.budget.spend(1);
    await current.db
      .update(schema.googleChatImportRuns)
      .set({ monthsDone, updatedAt: new Date() })
      .where(eq(schema.googleChatImportRuns.id, ctx.runId));
    current.run.monthsDone = monthsDone;
  }

  return { phaseComplete: monthsDone >= months.length };
}

async function completeImport(ctx: ChatImportTickContext, current: Current): Promise<void> {
  const months = ctx.sql
    .exec<{ month_path: string }>("SELECT month_path FROM months")
    .toArray()
    .map((row) => row.month_path);

  const incremental = Boolean(current.run.sinceCursor);
  let retainedPaths = months;
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
    retainedPaths = [...new Set([...existing.map((row) => row.path), ...months])];
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
    .update(schema.googleChatImportRuns)
    .set({ phase: "complete", consecutiveFailures: 0, updatedAt: new Date() })
    .where(eq(schema.googleChatImportRuns.id, ctx.runId));

  await deleteRunTempObjects(ctx, current.source.id);

  log("import_completed", {
    sourceId: current.source.id,
    runId: ctx.runId,
    pages: current.run.pagesFetched,
    messages: current.run.messagesFetched,
    months: months.length,
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
      .exec<{ r2_key: string }>("SELECT r2_key FROM months")
      .toArray()
      .map((r) => r.r2_key),
  ];
  for (const key of keys) {
    if (!ctx.budget.canSpend(1)) break;
    ctx.budget.spend(1);
    await ctx.env.BUCKET.delete(key);
  }
  // Best-effort prefix cleanup if listing is available.
  void sourceId;
}

export async function failChatImportRun(
  env: Env,
  runId: string,
  error: unknown,
): Promise<{ retryable: boolean; consecutiveFailures: number }> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = isRetryableFetchError(error);
  const current = await currentRun(env, runId);
  if (!current) return { retryable: false, consecutiveFailures: 0 };

  const consecutiveFailures = current.run.consecutiveFailures + 1;
  if (retryable && consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
    await current.db
      .update(schema.googleChatImportRuns)
      .set({
        consecutiveFailures,
        errorMessage: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(schema.googleChatImportRuns.id, runId));
    return { retryable: true, consecutiveFailures };
  }

  await current.db
    .update(schema.googleChatImportRuns)
    .set({
      phase: "error",
      consecutiveFailures,
      errorMessage: message.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(schema.googleChatImportRuns.id, runId));
  await current.db
    .update(schema.sources)
    .set({
      status: "error",
      fetchAttemptId: null,
      errorMessage: message.slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.sources.id, current.source.id),
        eq(schema.sources.fetchAttemptId, current.run.fetchAttemptId),
      ),
    );
  return { retryable: false, consecutiveFailures };
}

export function retryAlarmDelayMs(consecutiveFailures: number): number {
  return Math.min(60_000, ALARM_CONTINUE_MS * 2 ** Math.max(0, consecutiveFailures - 1));
}
