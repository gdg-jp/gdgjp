/**
 * Discord message normalization for source import (pure helpers + no network).
 */

import type { DiscordAttachment, DiscordMessage } from "../../../app/features/discord/api.server";
import { authorDisplayName } from "../../../app/features/discord/api.server";
import { periodTitle } from "./chat-periods";
import { formatChatTimestamp, weekPathFromCreateTime } from "./google-chat";

export interface NormalizedDiscordWeek {
  path: string;
  title: string;
  markdown: string;
  /** Latest message snowflake in this document (for incremental `after` cursor). */
  cursor: string | null;
  urls: string[];
  attachments: Array<{
    objectId: string;
    contentName: string;
    contentType: string;
    url: string;
    byteSize: number;
  }>;
}

export function warnDiscord(event: string, details: Record<string, string | number>): void {
  console.warn(
    JSON.stringify({
      component: "sources",
      integration: "discord",
      event,
      ...details,
    }),
  );
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/u, "");
}

export function extractUrlsFromDiscordMessage(message: DiscordMessage): string[] {
  const found = new Set<string>();
  for (const match of (message.content ?? "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    found.add(trimTrailingPunctuation(match[0]));
  }
  for (const embed of message.embeds ?? []) {
    if (embed.url?.startsWith("http")) found.add(embed.url);
  }
  return [...found];
}

export function discordAttachmentObjectId(attachment: DiscordAttachment): string {
  return attachment.id || attachment.filename;
}

function compareSnowflake(a: string, b: string): number {
  try {
    const left = BigInt(a);
    const right = BigInt(b);
    if (left === right) return 0;
    return left < right ? -1 : 1;
  } catch {
    return a.localeCompare(b);
  }
}

function maxSnowflake(current: string | null, next: string): string {
  if (!current) return next;
  return compareSnowflake(next, current) > 0 ? next : current;
}

/**
 * Turn Discord channel messages into weekly Markdown documents, or with `singleDocument`
 * into one document spanning their weeks (see `chat-periods.ts`).
 * Pure: no network. Messages may arrive in any order.
 */
export function normalizeDiscordMessages(
  messages: readonly DiscordMessage[],
  options?: { timeZone?: string; singleDocument?: boolean },
): NormalizedDiscordWeek[] {
  const timeZone = options?.timeZone ?? "Asia/Tokyo";
  const byDocument = new Map<
    string,
    {
      firstWeek: string;
      lastWeek: string;
      messages: DiscordMessage[];
      cursor: string | null;
      urls: Set<string>;
      attachments: NormalizedDiscordWeek["attachments"];
    }
  >();

  const sorted = [...messages].sort((a, b) => {
    const byTime = a.timestamp.localeCompare(b.timestamp);
    if (byTime !== 0) return byTime;
    return compareSnowflake(a.id, b.id);
  });

  for (const message of sorted) {
    if (!message.timestamp) continue;
    const weekPath = weekPathFromCreateTime(message.timestamp, timeZone);
    if (!weekPath) continue;
    const key = options?.singleDocument ? "" : weekPath;
    let bucket = byDocument.get(key);
    if (!bucket) {
      bucket = {
        firstWeek: weekPath,
        lastWeek: weekPath,
        messages: [],
        cursor: null,
        urls: new Set(),
        attachments: [],
      };
      byDocument.set(key, bucket);
    }
    // Messages are sorted by time, so the last one seen is in the latest week.
    bucket.lastWeek = weekPath;
    bucket.messages.push(message);
    bucket.cursor = maxSnowflake(bucket.cursor, message.id);
    for (const url of extractUrlsFromDiscordMessage(message)) bucket.urls.add(url);
    for (const attachment of message.attachments ?? []) {
      const objectId = discordAttachmentObjectId(attachment);
      bucket.attachments.push({
        objectId,
        contentName: attachment.filename || objectId,
        contentType: attachment.content_type || "application/octet-stream",
        url: attachment.url,
        byteSize: attachment.size,
      });
    }
  }

  const weeks: NormalizedDiscordWeek[] = [];
  const buckets = [...byDocument.values()].sort((a, b) => a.firstWeek.localeCompare(b.firstWeek));
  for (const bucket of buckets) {
    const title = periodTitle(bucket.firstWeek, bucket.lastWeek);
    const lines: string[] = [`# ${title}`, ""];
    for (const message of bucket.messages) {
      const stamp = formatChatTimestamp(message.timestamp, timeZone);
      const name = authorDisplayName(message.author);
      lines.push(`## [${stamp}] ${name}`);
      const body = (message.content ?? "").trimEnd();
      if (body) lines.push(body);
      for (const attachment of message.attachments ?? []) {
        const objectId = discordAttachmentObjectId(attachment);
        const contentName = attachment.filename || objectId;
        const isImage = (attachment.content_type ?? "").startsWith("image/");
        lines.push(
          isImage
            ? `![${contentName}](attachment:${objectId})`
            : `[${contentName}](attachment:${objectId})`,
        );
      }
      lines.push("");
    }
    weeks.push({
      path: bucket.firstWeek,
      title,
      markdown: `${lines.join("\n").trimEnd()}\n`,
      cursor: bucket.cursor,
      urls: [...bucket.urls],
      attachments: bucket.attachments,
    });
  }
  return weeks;
}

export function mergeDocumentUrls(
  existingMetadata: string | null | undefined,
  urls: readonly string[],
): string | null {
  const found = new Set<string>();
  if (existingMetadata) {
    try {
      const parsed = JSON.parse(existingMetadata) as { urls?: unknown };
      if (Array.isArray(parsed.urls)) {
        for (const url of parsed.urls) {
          if (typeof url === "string") found.add(url);
        }
      }
    } catch {
      // ignore malformed metadata
    }
  }
  for (const url of urls) found.add(url);
  if (found.size === 0) return null;
  return JSON.stringify({ urls: [...found] });
}
