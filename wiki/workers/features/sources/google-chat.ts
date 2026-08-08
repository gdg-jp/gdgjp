import { eq } from "drizzle-orm";
import * as schema from "../../../app/db/schema";
import { getDb } from "../../../app/lib/db.server";
import type { GoogleDocsInlineImage } from "../../../app/lib/google-docs-markdown.server";
import { getGoogleDriveTokenRow } from "../../../app/lib/google-drive-token.server";
import { hasRequiredGoogleChatScopes } from "../../../app/lib/google-drive.server";
import { type ResolvedSourceAsset, assetR2Key } from "./assets";
import { sha256Hex } from "./persist";

const CHAT_TIMEOUT_MS = 30_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 1000;

export const GOOGLE_CHAT_REAUTH_MESSAGE =
  "Google Chat or directory scopes are missing. Disconnect and reconnect Google from /sources to grant Chat and directory access.";

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
  /** Google Chat's user-authenticated message sender shape. */
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

export interface FetchedChatDocument {
  path: string;
  title: string;
  markdown: string;
  cursor: string | null;
  metadata: string | null;
  images: GoogleDocsInlineImage[];
  /** Attachments already downloaded into R2 (Chat media / Drive files). */
  assets: ResolvedSourceAsset[];
  /**
   * Incremental monthly fetches contain only newly downloaded assets. The caller
   * must preserve previously persisted assets instead of replacing them.
   */
  assetPolicy: "replace" | "merge";
}

export interface GoogleChatFetchResult {
  title: string;
  documents: FetchedChatDocument[];
  /** Paths that must stay `ready`, including months not touched this run. */
  retainedPaths: string[];
  accessToken: string;
}

export interface NormalizeChatOptions {
  /** Display-name lookup; defaults to a safe sender resource fallback. */
  resolveSenderName?: (sender: ChatMessageSender | undefined) => string;
  /** Known root-message bodies, including parents fetched outside the cursor window. */
  threadParents?: ReadonlyMap<string, string>;
  /** Time zone for YYYY-MM paths and timestamps. Defaults to Asia/Tokyo. */
  timeZone?: string;
}

export interface NormalizedMonth {
  path: string;
  title: string;
  markdown: string;
  /** createTime of the latest message in this month (RFC-3339). */
  cursor: string | null;
  urls: string[];
  attachments: Array<{
    objectId: string;
    contentName: string;
    contentType: string;
    attachment: ChatMessageAttachment;
  }>;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

/** Extract http(s) URLs from message text and rich-link annotations. */
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

export function monthPathFromCreateTime(
  createTime: string,
  timeZone = "Asia/Tokyo",
): string | null {
  const date = new Date(createTime);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) return null;
  return `${year}-${month}`;
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

/** Log only structured identifiers/statuses; message bodies must never enter worker logs. */
function warnGoogleChat(event: string, details: Record<string, string | number>): void {
  console.warn(
    JSON.stringify({
      component: "sources",
      integration: "google-chat",
      event,
      ...details,
    }),
  );
}

/**
 * Capture Google API error metadata without logging a successful response, which can
 * contain Chat content. `details` identifies invalid request fields for 400 errors.
 */
async function logGoogleChatMessagesListError(
  response: Response,
  input: { spaceName: string; filter: string | null; hasPageToken: boolean },
): Promise<void> {
  let googleError: Record<string, unknown> | null = null;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body.error && typeof body.error === "object" && !Array.isArray(body.error)) {
      const error = body.error as Record<string, unknown>;
      googleError = {
        code: error.code,
        status: error.status,
        message: error.message,
        details: error.details,
      };
    }
  } catch {
    // Some Google proxy errors do not have a JSON body; status metadata remains useful.
  }

  console.error(
    JSON.stringify({
      component: "sources",
      integration: "google-chat",
      event: "messages_list_failed",
      httpStatus: response.status,
      httpStatusText: response.statusText || undefined,
      spaceName: input.spaceName,
      pageSize: PAGE_SIZE,
      orderBy: "ASC",
      filter: input.filter ?? undefined,
      hasPageToken: input.hasPageToken,
      googleError,
    }),
  );
}

function oneLineQuote(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return `> _(${THREAD_PARENT_UNAVAILABLE})_`;
  return `> ${line.length > 200 ? `${line.slice(0, 197)}...` : line}`;
}

function threadParentText(message: ChatMessage): string | undefined {
  const text = message.text ?? message.argumentText ?? "";
  return text.trim() ? text : undefined;
}

function attachmentObjectId(attachment: ChatMessageAttachment, index: number): string {
  const fromName = attachment.name?.split("/").pop();
  if (fromName) return fromName;
  const driveId = attachment.driveDataRef?.driveFileId;
  if (driveId) return driveId;
  const resource = attachment.attachmentDataRef?.resourceName?.replace(/\//g, "_");
  if (resource) return resource;
  return `attachment-${index}`;
}

/**
 * Turn a Chat messages.list payload into monthly Markdown documents.
 * Pure: no network. Caller supplies sender resolution when names are prefetched.
 */
export function normalizeChatMessages(
  messages: readonly ChatMessage[],
  options: NormalizeChatOptions = {},
): NormalizedMonth[] {
  const timeZone = options.timeZone ?? "Asia/Tokyo";
  const resolveSender = options.resolveSenderName ?? defaultSenderName;

  const sorted = [...messages].sort((a, b) => {
    const at = a.createTime ?? "";
    const bt = b.createTime ?? "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

  // First non-reply in each thread is the parent we quote under replies.
  const threadParents = new Map(options.threadParents);
  for (const message of sorted) {
    const threadName = message.thread?.name;
    if (!threadName || message.threadReply) continue;
    const parent = threadParentText(message);
    if (parent !== undefined && !threadParents.has(threadName)) {
      threadParents.set(threadName, parent);
    }
  }

  const months = new Map<
    string,
    {
      blocks: string[];
      cursor: string | null;
      urls: Set<string>;
      attachments: NormalizedMonth["attachments"];
    }
  >();

  let attachmentIndex = 0;
  for (const message of sorted) {
    if (!message.createTime) continue;
    const path = monthPathFromCreateTime(message.createTime, timeZone);
    if (!path) continue;

    let bucket = months.get(path);
    if (!bucket) {
      bucket = { blocks: [], cursor: null, urls: new Set(), attachments: [] };
      months.set(path, bucket);
    }

    const sender = resolveSender(message.sender);
    const timestamp = formatChatTimestamp(message.createTime, timeZone);
    const body = (message.text ?? message.argumentText ?? "").trimEnd();
    const lines: string[] = [`## [${timestamp}] ${sender}`, ""];

    if (message.threadReply && message.thread?.name) {
      const parent = threadParents.get(message.thread.name);
      lines.push(
        parent === undefined ? `> _(${THREAD_PARENT_UNAVAILABLE})_` : oneLineQuote(parent),
        "",
      );
    }

    if (body) lines.push(body, "");

    for (const attachment of message.attachment ?? []) {
      const objectId = attachmentObjectId(attachment, attachmentIndex++);
      const contentName = attachment.contentName || objectId;
      const contentType = attachment.contentType || "application/octet-stream";
      bucket.attachments.push({ objectId, contentName, contentType, attachment });
      const isImage = contentType.startsWith("image/");
      if (isImage) {
        lines.push(`![${contentName}](attachment:${objectId})`, "");
      } else {
        lines.push(`[${contentName}](attachment:${objectId})`, "");
      }
    }

    for (const url of extractUrlsFromMessage(message)) bucket.urls.add(url);

    bucket.blocks.push(lines.join("\n").trimEnd());
    if (!bucket.cursor || message.createTime > bucket.cursor) {
      bucket.cursor = message.createTime;
    }
  }

  return [...months.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bucket]) => ({
      path,
      title: path,
      markdown: `${bucket.blocks.join("\n\n")}\n`,
      cursor: bucket.cursor,
      urls: [...bucket.urls],
      attachments: bucket.attachments,
    }));
}

/** Append newly normalized markdown to an existing monthly document body. */
export function appendMonthlyMarkdown(existing: string, addition: string): string {
  const left = existing.replace(/\s*$/, "");
  const right = addition.replace(/^\s*/, "").replace(/\s*$/, "");
  if (!left) return right ? `${right}\n` : "";
  if (!right) return `${left}\n`;
  return `${left}\n\n${right}\n`;
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
    } catch {
      // Ignore corrupt metadata; rebuild from this fetch.
    }
  }
  for (const url of urls) set.add(url);
  if (set.size === 0) return existingMetadata ?? null;
  return JSON.stringify({ urls: [...set].sort() });
}

export function currentMonthPath(now = new Date(), timeZone = "Asia/Tokyo"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function startOfMonthRfc3339(monthPath: string): string {
  // Asia/Tokyo midnight on the 1st — matches the default path time zone.
  return new Date(`${monthPath}-01T00:00:00+09:00`).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function listChatMessages(
  spaceName: string,
  accessToken: string,
  filter: string | null,
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
    });
    if (filter) params.set("filter", filter);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceName}/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      CHAT_TIMEOUT_MS,
    );
    if (!response.ok) {
      await logGoogleChatMessagesListError(response, {
        spaceName,
        filter,
        hasPageToken: Boolean(pageToken),
      });
      throw new Error(`Google Chat messages.list failed (${response.status})`);
    }
    const body = (await response.json()) as {
      messages?: ChatMessage[];
      nextPageToken?: string;
    };
    if (body.messages) messages.push(...body.messages);
    pageToken = body.nextPageToken;
  } while (pageToken);

  return messages;
}

export async function resolvePeopleDisplayNames(
  accessToken: string,
  senders: readonly ChatMessageSender[],
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  const unique = new Map<string, ChatMessageSender>();
  for (const sender of senders) {
    if (!sender?.name || cache.has(sender.name)) continue;
    if (sender.type === "BOT") {
      cache.set(sender.name, "Bot");
      continue;
    }
    unique.set(sender.name, sender);
  }

  for (const [userName, sender] of unique) {
    const peopleName = userName.startsWith("users/")
      ? userName.replace(/^users\//, "people/")
      : userName.startsWith("people/")
        ? userName
        : `people/${userName}`;
    try {
      const response = await fetchWithTimeout(
        `https://people.googleapis.com/v1/${peopleName}?personFields=names&sources=READ_SOURCE_TYPE_PROFILE`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        CHAT_TIMEOUT_MS,
      );
      if (response.ok) {
        const person = (await response.json()) as {
          names?: Array<{ displayName?: string }>;
        };
        const displayName = person.names?.[0]?.displayName?.trim();
        if (displayName) {
          cache.set(userName, displayName);
          continue;
        }
      }
      warnGoogleChat("sender_name_unresolved", { sender: userName, status: response.status });
    } catch {
      // Do not log message bodies, response bodies, or request errors: these can contain PII.
      warnGoogleChat("sender_name_lookup_failed", { sender: userName });
    }
    cache.set(userName, defaultSenderName(sender));
  }

  return cache;
}

/**
 * Fetch root messages for reply threads whose parent is outside the cursor window.
 * These are context-only: callers seed normalization with this map but never add the
 * fetched parent messages to the source-document content or cursor calculation.
 */
export async function fetchMissingReplyThreadParents(
  spaceName: string,
  accessToken: string,
  messages: readonly ChatMessage[],
): Promise<Map<string, string>> {
  const parents = new Map<string, string>();
  const replyThreads = new Set<string>();

  for (const message of messages) {
    const threadName = message.thread?.name;
    if (!threadName) continue;
    if (message.threadReply) {
      replyThreads.add(threadName);
    } else if (!parents.has(threadName)) {
      const parent = threadParentText(message);
      if (parent !== undefined) parents.set(threadName, parent);
    }
  }

  for (const threadName of replyThreads) {
    if (parents.has(threadName)) continue;
    const threadMessages = await listChatMessages(
      spaceName,
      accessToken,
      `thread.name = ${threadName}`,
    );
    const parent = threadMessages.find(
      (message) => !message.threadReply && message.thread?.name === threadName,
    );
    const parentText = parent ? threadParentText(parent) : undefined;
    if (parentText !== undefined) {
      parents.set(threadName, parentText);
    } else {
      warnGoogleChat("thread_parent_unavailable", { thread: threadName });
    }
  }

  return parents;
}

async function downloadChatAttachment(
  env: Env,
  sourceId: string,
  accessToken: string,
  objectId: string,
  contentType: string,
  attachment: ChatMessageAttachment,
): Promise<ResolvedSourceAsset | null> {
  let response: Response | null = null;

  const driveFileId = attachment.driveDataRef?.driveFileId;
  const mediaResource = attachment.attachmentDataRef?.resourceName;

  if (driveFileId) {
    response = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      CHAT_TIMEOUT_MS,
    );
  } else if (mediaResource) {
    response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/media/${mediaResource}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      CHAT_TIMEOUT_MS,
    );
  }

  if (!response) return null;
  if (response.status === 404) {
    console.warn("[sources] chat attachment unavailable", objectId);
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unable to download a Google Chat attachment (${response.status})`);
  }

  const mimeType =
    response.headers.get("Content-Type")?.split(";")[0] ||
    contentType ||
    "application/octet-stream";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("A Google Chat attachment exceeds the 10 MB limit");
  }

  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, objectId, contentHash, mimeType);
  await env.BUCKET.put(r2Key, bytes, {
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

async function getSpaceDisplayName(spaceName: string, accessToken: string): Promise<string> {
  const response = await fetchWithTimeout(
    `https://chat.googleapis.com/v1/${spaceName}?fields=name,displayName`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    CHAT_TIMEOUT_MS,
  );
  if (!response.ok) return spaceName;
  const space = (await response.json()) as ChatSpace;
  return space.displayName?.trim() || spaceName;
}

/**
 * Fetch a Google Chat Space into monthly raw source_documents.
 *
 * Initial fetch pulls the full history. Refetches only the current month with
 * `createTime > cursor`, append to the existing Markdown, and leave prior months alone.
 */
export async function fetchGoogleChatSource(
  env: Env,
  input: {
    sourceId: string;
    spaceName: string;
    addedBy: string;
    now?: Date;
  },
): Promise<GoogleChatFetchResult> {
  const db = getDb(env);
  const token = await getGoogleDriveTokenRow(env, db, input.addedBy);
  if (!hasRequiredGoogleChatScopes(token.grantedScopes)) {
    throw new Error(GOOGLE_CHAT_REAUTH_MESSAGE);
  }

  const accessToken = token.accessToken;
  const spaceName = input.spaceName.startsWith("spaces/")
    ? input.spaceName
    : `spaces/${input.spaceName}`;

  const existing = await db
    .select({
      path: schema.sourceDocuments.path,
      cursor: schema.sourceDocuments.cursor,
      r2Key: schema.sourceDocuments.r2Key,
      metadata: schema.sourceDocuments.metadata,
      status: schema.sourceDocuments.status,
    })
    .from(schema.sourceDocuments)
    .where(eq(schema.sourceDocuments.sourceId, input.sourceId))
    .all();

  const readyExisting = existing.filter((row) => row.status !== "archived");
  const byPath = new Map(readyExisting.map((row) => [row.path, row]));
  const thisMonth = currentMonthPath(input.now);
  const existingCurrent = byPath.get(thisMonth);
  const incremental = readyExisting.length > 0;

  let filter: string | null = null;
  if (incremental) {
    if (existingCurrent?.cursor) {
      filter = `createTime > "${existingCurrent.cursor}"`;
    } else {
      filter = `createTime >= "${startOfMonthRfc3339(thisMonth)}"`;
    }
  }

  const messages = await listChatMessages(spaceName, accessToken, filter);
  const threadParents = await fetchMissingReplyThreadParents(spaceName, accessToken, messages);
  const nameCache = await resolvePeopleDisplayNames(
    accessToken,
    messages.map((message) => message.sender).filter(Boolean) as ChatMessageSender[],
  );

  const months = normalizeChatMessages(messages, {
    resolveSenderName: (sender) => {
      if (sender?.name && nameCache.has(sender.name)) {
        return nameCache.get(sender.name) ?? defaultSenderName(sender);
      }
      return defaultSenderName(sender);
    },
    threadParents,
  });

  // Incremental runs only keep the current month from the API response; older
  // months in the response (shouldn't happen with the filter) are ignored.
  const monthsToWrite = incremental ? months.filter((month) => month.path === thisMonth) : months;

  const documents: FetchedChatDocument[] = [];

  for (const month of monthsToWrite) {
    const prior = byPath.get(month.path);
    let markdown = month.markdown;
    let metadata = mergeDocumentUrls(prior?.metadata, month.urls);
    let cursor = month.cursor;

    if (prior && incremental && month.path === thisMonth) {
      const previousObject = await env.BUCKET.get(prior.r2Key);
      const previousMarkdown = previousObject ? await previousObject.text() : "";
      markdown = appendMonthlyMarkdown(previousMarkdown, month.markdown);
      metadata = mergeDocumentUrls(prior.metadata, month.urls);
      if (prior.cursor && (!cursor || prior.cursor > cursor)) cursor = prior.cursor;
    }

    const assets: ResolvedSourceAsset[] = [];
    const images: GoogleDocsInlineImage[] = [];

    for (const item of month.attachments) {
      const asset = await downloadChatAttachment(
        env,
        input.sourceId,
        accessToken,
        item.objectId,
        item.contentType,
        item.attachment,
      );
      if (!asset) {
        markdown = markdown
          .replaceAll(`![${item.contentName}](attachment:${item.objectId})`, "")
          .replaceAll(`[${item.contentName}](attachment:${item.objectId})`, item.contentName);
        continue;
      }
      assets.push(asset);
      markdown = markdown.replaceAll(`attachment:${item.objectId}`, asset.path);
    }

    documents.push({
      path: month.path,
      title: month.title,
      markdown,
      cursor,
      metadata,
      images,
      assets,
      assetPolicy: incremental ? "merge" : "replace",
    });
  }

  const title = await getSpaceDisplayName(spaceName, accessToken);
  const retainedPaths = [
    ...new Set([...readyExisting.map((row) => row.path), ...documents.map((doc) => doc.path)]),
  ];

  return { title, documents, retainedPaths, accessToken };
}
