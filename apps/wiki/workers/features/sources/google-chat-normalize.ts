import { periodTitle } from "./chat-periods";

export interface ChatMessageAttachment {
  name?: string;
  contentName?: string;
  contentType?: string;
  attachmentDataRef?: { resourceName?: string };
  driveDataRef?: { driveFileId?: string };
  source?: string;
}

export interface ChatMessageSender {
  name?: string;
  type?: "HUMAN" | "BOT";
}

export interface ChatMessage {
  name?: string;
  text?: string;
  argumentText?: string;
  createTime?: string;
  threadReply?: boolean;
  thread?: { name?: string };
  sender?: ChatMessageSender;
  attachment?: ChatMessageAttachment[];
  annotations?: Array<{
    type?: string;
    startIndex?: number;
    length?: number;
    richLinkMetadata?: { uri?: string };
  }>;
}

export interface ChatSpace {
  name: string;
  displayName?: string;
  spaceType?: string;
}

export interface NormalizeChatOptions {
  resolveSenderName?: (sender: ChatMessageSender | undefined) => string;
  threadParents?: ReadonlyMap<string, string>;
  timeZone?: string;
  singleDocument?: boolean;
}

export interface NormalizedWeek {
  path: string;
  title: string;
  markdown: string;
  cursor: string | null;
  urls: string[];
  attachments: Array<{
    objectId: string;
    contentName: string;
    contentType: string;
    attachment: ChatMessageAttachment;
  }>;
}

export function splitMarkdownByUtf8Bytes(markdown: string, maxBytes: number): string[] {
  if (maxBytes <= 0) throw new Error("maxBytes must be positive");
  const encoder = new TextEncoder();
  if (encoder.encode(markdown).byteLength <= maxBytes) return [markdown];

  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  for (const codePoint of markdown) {
    const bytes = encoder.encode(codePoint).byteLength;
    if (chunkBytes > 0 && chunkBytes + bytes > maxBytes) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    if (bytes > maxBytes) throw new Error("A single code point exceeds the Markdown byte limit");
    chunk += codePoint;
    chunkBytes += bytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function extractUrlsFromMessage(message: ChatMessage): string[] {
  const found = new Set<string>();
  const body = message.text ?? message.argumentText ?? "";
  for (const match of body.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    found.add(trimTrailingPunctuation(match[0]));
  }
  for (const annotation of message.annotations ?? []) {
    const uri = annotation.richLinkMetadata?.uri;
    if (uri?.startsWith("http")) found.add(uri);
  }
  return [...found];
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[),.;!?]+$/u, "");
}

export function weekPathFromCreateTime(createTime: string, timeZone = "Asia/Tokyo"): string | null {
  const date = new Date(createTime);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;

  const localDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  return localDate.toISOString().slice(0, 10);
}

export function weekBoundsRfc3339(
  weekPath: string,
  timeZone = "Asia/Tokyo",
): { start: string; end: string } | null {
  const localMonday = new Date(`${weekPath}T00:00:00Z`);
  if (Number.isNaN(localMonday.getTime())) return null;
  const format = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  };
  localMonday.setUTCHours(12);
  const startDate = format(localMonday);
  localMonday.setUTCDate(localMonday.getUTCDate() + 7);
  const endDate = format(localMonday);
  if (!startDate || !endDate) return null;
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${startDate}T12:00:00Z`));
  const offset =
    offsetParts.find((part) => part.type === "timeZoneName")?.value?.replace("GMT", "") || "+00:00";
  return {
    start: new Date(`${startDate}T00:00:00${offset}`).toISOString().replace(/\.\d{3}Z$/, "Z"),
    end: new Date(`${endDate}T00:00:00${offset}`).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

export function formatChatTimestamp(createTime: string, timeZone = "Asia/Tokyo"): string {
  const date = new Date(createTime);
  if (Number.isNaN(date.getTime())) return createTime;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export const THREAD_PARENT_UNAVAILABLE = "Parent message unavailable";

export function defaultSenderName(sender: ChatMessageSender | undefined): string {
  if (sender?.type === "BOT") return "Bot";
  const name = sender?.name?.trim();
  return name ? `Unknown user (${name})` : "Unknown user";
}

function oneLineQuote(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return `> _(${THREAD_PARENT_UNAVAILABLE})_`;
  return `> ${line.length > 200 ? `${line.slice(0, 197)}...` : line}`;
}

function threadHeading(text: string | undefined): string {
  const line = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "Thread";
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

export function threadParentText(message: ChatMessage): string | undefined {
  const text = message.text ?? message.argumentText ?? "";
  return text.trim() ? text : undefined;
}

export function attachmentObjectId(attachment: ChatMessageAttachment, index: number): string {
  const fromName = attachment.name?.split("/").pop();
  if (fromName) return fromName;
  const driveId = attachment.driveDataRef?.driveFileId;
  if (driveId) return driveId;
  const resource = attachment.attachmentDataRef?.resourceName?.replace(/\//g, "_");
  if (resource) return resource;
  return `attachment-${index}`;
}

export function normalizeChatMessages(
  messages: readonly ChatMessage[],
  options: NormalizeChatOptions = {},
): NormalizedWeek[] {
  const timeZone = options.timeZone ?? "Asia/Tokyo";
  const resolveSender = options.resolveSenderName ?? defaultSenderName;

  const sorted = [...messages].sort((a, b) => {
    const at = a.createTime ?? "";
    const bt = b.createTime ?? "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

  const threadParents = new Map(options.threadParents);
  for (const message of sorted) {
    const threadName = message.thread?.name;
    if (!threadName || message.threadReply) continue;
    const parent = threadParentText(message);
    if (parent !== undefined && !threadParents.has(threadName)) {
      threadParents.set(threadName, parent);
    }
  }

  const weeks = new Map<
    string,
    {
      firstWeek: string;
      lastWeek: string;
      cursor: string | null;
      urls: Set<string>;
      attachments: NormalizedWeek["attachments"];
      threads: Map<string, ChatMessage[]>;
    }
  >();

  for (let messageIndex = 0; messageIndex < sorted.length; messageIndex += 1) {
    const message = sorted[messageIndex];
    if (!message.createTime) continue;
    const path = weekPathFromCreateTime(message.createTime, timeZone);
    if (!path) continue;

    const key = options.singleDocument ? "" : path;
    let bucket = weeks.get(key);
    if (!bucket) {
      bucket = {
        firstWeek: path,
        lastWeek: path,
        cursor: null,
        urls: new Set(),
        attachments: [],
        threads: new Map(),
      };
      weeks.set(key, bucket);
    }
    bucket.lastWeek = path;

    const threadKey = message.thread?.name || message.name || `message-${messageIndex}`;
    const thread = bucket.threads.get(threadKey) ?? [];
    thread.push(message);
    bucket.threads.set(threadKey, thread);

    for (const [attachmentIndex, attachment] of (message.attachment ?? []).entries()) {
      const objectId = attachmentObjectId(attachment, messageIndex * 1000 + attachmentIndex);
      const contentName = attachment.contentName || objectId;
      const contentType = attachment.contentType || "application/octet-stream";
      bucket.attachments.push({ objectId, contentName, contentType, attachment });
    }

    for (const url of extractUrlsFromMessage(message)) bucket.urls.add(url);
    if (!bucket.cursor || message.createTime > bucket.cursor) {
      bucket.cursor = message.createTime;
    }
  }

  return [...weeks.values()]
    .sort((a, b) => (a.firstWeek < b.firstWeek ? -1 : a.firstWeek > b.firstWeek ? 1 : 0))
    .map((bucket) => ({
      path: bucket.firstWeek,
      title: periodTitle(bucket.firstWeek, bucket.lastWeek),
      markdown: `${[...bucket.threads.entries()]
        .sort(([, left], [, right]) => {
          const leftTime = left[0]?.createTime ?? "";
          const rightTime = right[0]?.createTime ?? "";
          return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
        })
        .map(([threadName, messages]) => {
          const ordered = [...messages].sort((left, right) => {
            if (left.threadReply !== right.threadReply) return left.threadReply ? 1 : -1;
            const leftTime = left.createTime ?? "";
            const rightTime = right.createTime ?? "";
            return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
          });
          const root = ordered.find((message) => !message.threadReply);
          const first = ordered[0];
          if (!first?.createTime) return "";
          const lines = [
            `## [${formatChatTimestamp(first.createTime, timeZone)}] ${threadHeading(threadParentText(root ?? first))}`,
            "",
          ];
          if (!root && messages.some((message) => message.threadReply) && threadName) {
            const parent = threadParents.get(threadName);
            lines.push(
              parent === undefined ? `> _(${THREAD_PARENT_UNAVAILABLE})_` : oneLineQuote(parent),
              "",
            );
          }
          for (const message of ordered) {
            if (!message.createTime) continue;
            const body = (message.text ?? message.argumentText ?? "").trimEnd();
            lines.push(
              `### [${formatChatTimestamp(message.createTime, timeZone)}] ${resolveSender(message.sender)}`,
              "",
            );
            if (body) lines.push(body, "");
            for (const [attachmentIndex, attachment] of (message.attachment ?? []).entries()) {
              const objectId = attachmentObjectId(
                attachment,
                sorted.indexOf(message) * 1000 + attachmentIndex,
              );
              const contentName = attachment.contentName || objectId;
              lines.push(
                attachment.contentType?.startsWith("image/")
                  ? `![${contentName}](attachment:${objectId})`
                  : `[${contentName}](attachment:${objectId})`,
                "",
              );
            }
          }
          return lines.join("\n").trimEnd();
        })
        .filter(Boolean)
        .join("\n\n")}\n`,
      cursor: bucket.cursor,
      urls: [...bucket.urls],
      attachments: bucket.attachments,
    }));
}

export function mergeDocumentUrls(
  existingMetadata: string | null | undefined,
  urls: readonly string[],
): string | null {
  const set = new Set<string>();
  if (existingMetadata) {
    try {
      const parsed = JSON.parse(existingMetadata) as { urls?: unknown };
      if (Array.isArray(parsed.urls)) {
        for (const url of parsed.urls) {
          if (typeof url === "string" && url) set.add(url);
        }
      }
    } catch {}
  }
  for (const url of urls) set.add(url);
  if (set.size === 0) return existingMetadata ?? null;
  return JSON.stringify({ urls: [...set].sort() });
}
