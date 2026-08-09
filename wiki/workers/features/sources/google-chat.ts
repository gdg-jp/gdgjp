const CHAT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;

export const GOOGLE_CHAT_REAUTH_MESSAGE =
  "Google Chat, Drive, or directory scopes are missing. Disconnect and reconnect Google from /sources to grant the required access.";

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
export function warnGoogleChat(event: string, details: Record<string, string | number>): void {
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
export async function logGoogleChatMessagesListError(
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

export function attachmentObjectId(attachment: ChatMessageAttachment, index: number): string {
  const fromName = attachment.name?.split("/").pop();
  if (fromName) return fromName;
  const driveId = attachment.driveDataRef?.driveFileId;
  if (driveId) return driveId;
  const resource = attachment.attachmentDataRef?.resourceName?.replace(/\//g, "_");
  if (resource) return resource;
  return `attachment-${index}`;
}

export function peopleResourceName(userName: string): string {
  if (userName.startsWith("people/")) return userName;
  if (userName.startsWith("users/")) return userName.replace(/^users\//, "people/");
  return `people/${userName}`;
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

const PEOPLE_BATCH_SIZE = 200;

/**
 * Resolve human sender display names with People `people:batchGet` (≤200 / request).
 * Callers should prefer Chat `spaces.members.list` first and only batch-get the remainder.
 */
export async function resolvePeopleDisplayNames(
  accessToken: string,
  senders: readonly ChatMessageSender[],
  options: { onFetch?: () => void } = {},
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

  const pending = [...unique.entries()];
  for (let offset = 0; offset < pending.length; offset += PEOPLE_BATCH_SIZE) {
    const chunk = pending.slice(offset, offset + PEOPLE_BATCH_SIZE);
    const params = new URLSearchParams({
      personFields: "names",
      sources: "READ_SOURCE_TYPE_PROFILE",
    });
    for (const [userName] of chunk) {
      params.append("resourceNames", peopleResourceName(userName));
    }
    options.onFetch?.();
    try {
      const response = await fetchWithTimeout(
        `https://people.googleapis.com/v1/people:batchGet?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        CHAT_TIMEOUT_MS,
      );
      if (!response.ok) {
        for (const [userName, sender] of chunk) {
          warnGoogleChat("sender_name_unresolved", { sender: userName, status: response.status });
          cache.set(userName, defaultSenderName(sender));
        }
        continue;
      }
      const body = (await response.json()) as {
        responses?: Array<{
          httpStatusCode?: number;
          person?: { resourceName?: string; names?: Array<{ displayName?: string }> };
          requestedResourceName?: string;
        }>;
      };
      const byRequested = new Map(
        (body.responses ?? []).map((row) => [row.requestedResourceName ?? "", row]),
      );
      for (const [userName, sender] of chunk) {
        const row = byRequested.get(peopleResourceName(userName));
        const displayName = row?.person?.names?.[0]?.displayName?.trim();
        if (displayName) {
          cache.set(userName, displayName);
          continue;
        }
        warnGoogleChat("sender_name_unresolved", {
          sender: userName,
          status: row?.httpStatusCode ?? response.status,
        });
        cache.set(userName, defaultSenderName(sender));
      }
    } catch {
      for (const [userName, sender] of chunk) {
        warnGoogleChat("sender_name_lookup_failed", { sender: userName });
        cache.set(userName, defaultSenderName(sender));
      }
    }
  }

  return cache;
}

/**
 * Prefill display names from `spaces.members.list` (≤1000 / page). Returns names keyed by
 * `users/...` resource names so they match Chat message sender fields.
 */
export async function resolveSpaceMemberDisplayNames(
  spaceName: string,
  accessToken: string,
  options: { onFetch?: () => void } = {},
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    options.onFetch?.();
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/${spaceName}/members?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      CHAT_TIMEOUT_MS,
    );
    if (!response.ok) {
      warnGoogleChat("members_list_failed", { spaceName, status: response.status });
      break;
    }
    const body = (await response.json()) as {
      memberships?: Array<{
        member?: { name?: string; displayName?: string; type?: string };
      }>;
      nextPageToken?: string;
    };
    for (const membership of body.memberships ?? []) {
      const member = membership.member;
      const name = member?.name?.trim();
      const displayName = member?.displayName?.trim();
      if (!name || !displayName) continue;
      if (member?.type === "BOT") {
        cache.set(name, "Bot");
        continue;
      }
      cache.set(name, displayName);
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return cache;
}

/**
 * Fetch the root message text for a single reply thread (incremental context only).
 */
export async function fetchThreadParentText(
  spaceName: string,
  accessToken: string,
  threadName: string,
  options: { onFetch?: () => void } = {},
): Promise<string | undefined> {
  const threadMessages = await listChatMessages(
    spaceName,
    accessToken,
    `thread.name = ${threadName}`,
    options,
  );
  const parent = threadMessages.find(
    (message) => !message.threadReply && message.thread?.name === threadName,
  );
  const parentText = parent ? threadParentText(parent) : undefined;
  if (parentText === undefined) {
    warnGoogleChat("thread_parent_unavailable", { thread: threadName });
  }
  return parentText;
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
  options: { onFetch?: () => void; shouldContinue?: () => boolean } = {},
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
    if (options.shouldContinue && !options.shouldContinue()) break;
    const parentText = await fetchThreadParentText(spaceName, accessToken, threadName, options);
    if (parentText !== undefined) parents.set(threadName, parentText);
  }

  return parents;
}

async function listChatMessages(
  spaceName: string,
  accessToken: string,
  filter: string | null,
  options: { onFetch?: () => void } = {},
): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
    });
    if (filter) params.set("filter", filter);
    if (pageToken) params.set("pageToken", pageToken);

    options.onFetch?.();
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
