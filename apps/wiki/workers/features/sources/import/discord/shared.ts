import type * as schema from "../../../../../app/db/schema";
import type { DiscordMessage } from "../../../../../app/features/discord/api.server";
import { parseDiscordChannelUrl } from "../../../../../app/features/discord/api.server";
import { DISCORD_BOT_ACCESS_MESSAGE } from "../../../../../app/features/discord/oauth.server";
import { discordAttachmentObjectId } from "../../discord";
import { weekPathFromCreateTime } from "../../google-chat";
import type { CurrentSourceImport, SourceImportTickContext } from "../run";

export const DISCORD_PAGE_SIZE = 100;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type DiscordImportPhase =
  | "listing"
  | "attachments"
  | "grouping"
  | "finalizing"
  | "complete"
  | "error";

export type StepOutcome = { phaseComplete: boolean; continueAfterMs?: number };

export type DiscordImportTickContext = SourceImportTickContext;
export type Current = CurrentSourceImport;

export function log(
  event: string,
  details: Record<string, string | number | boolean | undefined | null>,
): void {
  console.log(JSON.stringify({ component: "sources", integration: "discord", event, ...details }));
}

export function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function requireBotToken(ctx: DiscordImportTickContext): string {
  const token = ctx.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error(DISCORD_BOT_ACCESS_MESSAGE);
  return token;
}

export function channelIdOf(source: typeof schema.sources.$inferSelect): string {
  if (source.externalId) return source.externalId;
  const parsed = parseDiscordChannelUrl(source.url);
  if (!parsed) throw new Error("Discord source is missing a channel id");
  return parsed.channelId;
}

export function indexMessage(sql: SqlStorage, message: DiscordMessage): void {
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
