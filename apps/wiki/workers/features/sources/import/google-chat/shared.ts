import type * as schema from "../../../../../app/db/schema";
import { type ChatMessage, attachmentObjectId, weekPathFromCreateTime } from "../../google-chat";
import type { CurrentSourceImport, SourceImportTickContext } from "../run";

export const CHAT_PAGE_SIZE = 100;
export const CHAT_TIMEOUT_MS = 30_000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
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

export type ChatImportTickContext = SourceImportTickContext;
export type Current = CurrentSourceImport;

export function log(
  event: string,
  details: Record<string, string | number | boolean | undefined | null>,
): void {
  console.log(
    JSON.stringify({ component: "sources", integration: "google-chat", event, ...details }),
  );
}

export function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function spaceNameOf(source: typeof schema.sources.$inferSelect): string {
  return source.externalId?.startsWith("spaces/")
    ? source.externalId
    : `spaces/${source.externalId}`;
}

export function requireAccessToken(ctx: ChatImportTickContext): string {
  if (!ctx.accessToken) throw new Error("Chat import tick is missing a resolved access token");
  return ctx.accessToken;
}

export function indexMessage(
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
