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
  /** Time zone for Monday-date paths and timestamps. Defaults to Asia/Tokyo. */
  timeZone?: string;
}

export interface NormalizedWeek {
  path: string;
  title: string;
  markdown: string;
  /** createTime of the latest message in this week (RFC-3339). */
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

/** Return the Asia/Tokyo (by default) date of the Monday containing createTime. */
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

  // Interpret the formatted local calendar date at UTC midnight. This is deliberate:
  // we only need calendar arithmetic, so it avoids applying the Tokyo offset twice.
  const localDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);
  return localDate.toISOString().slice(0, 10);
}

/** RFC-3339 bounds for a Monday-date document, in the source's local time zone. */
export function weekBoundsRfc3339(
  weekPath: string,
  timeZone = "Asia/Tokyo",
): { start: string; end: string } | null {
  // The path is a local calendar date. Constructing it at UTC is only for calendar
  // arithmetic; the resulting date parts are then formatted in the requested zone.
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
  // For Asia/Tokyo this date is the previous calendar day, so use a noon UTC anchor
  // before formatting to recover the requested local calendar date.
  localMonday.setUTCHours(12);
  const startDate = format(localMonday);
  localMonday.setUTCDate(localMonday.getUTCDate() + 7);
  const endDate = format(localMonday);
  if (!startDate || !endDate) return null;
  // Google accepts offset-less RFC-3339 UTC values. Tokyo is the only current source
  // zone, but derive its actual offset rather than hard-coding it in path arithmetic.
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

function threadHeading(text: string | undefined): string {
  const line = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!line) return "Thread";
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

function weekTitle(weekPath: string): string {
  const start = new Date(`${weekPath}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  return `${weekPath} – ${start.toISOString().slice(0, 10)}`;
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
 * Turn a Chat messages.list payload into weekly, thread-grouped Markdown documents.
 * Pure: no network. Caller supplies sender resolution when names are prefetched.
 */
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

  // Roots fetched outside the selected week are context-only. Roots in the current
  // week are rendered as normal messages and must not be repeated as quotes.
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

    let bucket = weeks.get(path);
    if (!bucket) {
      bucket = { cursor: null, urls: new Set(), attachments: [], threads: new Map() };
      weeks.set(path, bucket);
    }

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

  return [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, bucket]) => ({
      path,
      title: weekTitle(path),
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
    } catch {
      // Ignore corrupt metadata; rebuild from this fetch.
    }
  }
  for (const url of urls) set.add(url);
  if (set.size === 0) return existingMetadata ?? null;
  return JSON.stringify({ urls: [...set].sort() });
}

const PEOPLE_BATCH_SIZE = 200;

export interface SenderLookupOptions {
  onFetch?: () => void;
  /** Stop before issuing another request when the import tick has no budget left. */
  shouldContinue?: () => boolean;
}

interface GooglePeopleErrorInput {
  operation: "batch_get" | "directory_list";
  batchSize?: number;
  hasPageToken?: boolean;
}

/** Log Google People API diagnostics without recording directory or message content. */
export async function logGooglePeopleError(
  response: Response,
  input: GooglePeopleErrorInput,
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
    // Non-JSON proxy responses still have useful HTTP metadata.
  }
  console.error(
    JSON.stringify({
      component: "sources",
      integration: "google-chat",
      event: "people_lookup_failed",
      operation: input.operation,
      httpStatus: response.status,
      httpStatusText: response.statusText || undefined,
      batchSize: input.batchSize,
      hasPageToken: input.hasPageToken,
      googleError,
    }),
  );
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")
  );
}

function displayNameFromPerson(person: {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
}): string | undefined {
  const displayName = person.names?.[0]?.displayName?.trim();
  if (displayName) return displayName;
  const email = person.emailAddresses?.find((item) => item.value?.includes("@"))?.value;
  const localPart = email?.split("@", 1)[0]?.trim();
  return localPart || undefined;
}

function addPersonNames(
  names: Map<string, string>,
  person: {
    resourceName?: string;
    metadata?: { sources?: Array<{ id?: string }> };
    names?: Array<{ displayName?: string }>;
  },
): void {
  const displayName = person.names?.[0]?.displayName?.trim();
  if (!displayName) return;
  const ids = [
    person.resourceName?.replace(/^people\//, ""),
    ...(person.metadata?.sources ?? []).map((source) => source.id),
  ];
  for (const id of ids) {
    if (!id) continue;
    names.set(`users/${id.replace(/^(?:people|users)\//, "")}`, displayName);
  }
}

export interface DirectoryPeopleResult {
  names: Map<string, string>;
  nextPageToken: string | null;
  complete: boolean;
}

/**
 * Resolve Workspace users from the domain directory. This is deliberately the
 * primary path: Chat's user-authenticated membership response usually omits
 * displayName. `nextPageToken` belongs in DO SQLite so long directories resume.
 */
export async function resolveDirectoryPeopleDisplayNames(
  accessToken: string,
  options: SenderLookupOptions & { pageToken?: string | null } = {},
): Promise<DirectoryPeopleResult> {
  const names = new Map<string, string>();
  let pageToken = options.pageToken ?? undefined;
  do {
    if (options.shouldContinue && !options.shouldContinue()) {
      return { names, nextPageToken: pageToken ?? null, complete: false };
    }
    const params = new URLSearchParams({
      readMask: "names,metadata",
      sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
      pageSize: "1000",
    });
    if (pageToken) params.set("pageToken", pageToken);
    options.onFetch?.();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `https://people.googleapis.com/v1/people:listDirectoryPeople?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        CHAT_TIMEOUT_MS,
      );
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
      warnGoogleChat("directory_people_lookup_failed", { retryable: 1 });
      return { names, nextPageToken: pageToken ?? null, complete: false };
    }
    if (!response.ok) {
      await logGooglePeopleError(response, {
        operation: "directory_list",
        hasPageToken: Boolean(pageToken),
      });
      return { names, nextPageToken: null, complete: true };
    }
    const body = (await response.json()) as {
      people?: Array<{
        resourceName?: string;
        metadata?: { sources?: Array<{ id?: string }> };
        names?: Array<{ displayName?: string }>;
      }>;
      nextPageToken?: string;
    };
    for (const person of body.people ?? []) addPersonNames(names, person);
    pageToken = body.nextPageToken;
  } while (pageToken);
  return { names, nextPageToken: null, complete: true };
}

/**
 * Resolve human sender display names with People `people:batchGet` (≤200 / request).
 * Callers should prefer Chat `spaces.members.list` first and only batch-get the remainder.
 */
export async function resolvePeopleDisplayNames(
  accessToken: string,
  senders: readonly ChatMessageSender[],
  options: SenderLookupOptions = {},
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
    if (options.shouldContinue && !options.shouldContinue()) break;
    const chunk = pending.slice(offset, offset + PEOPLE_BATCH_SIZE);
    const params = new URLSearchParams({
      personFields: "names,emailAddresses",
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
        await logGooglePeopleError(response, { operation: "batch_get", batchSize: chunk.length });
        for (const [userName, sender] of chunk) {
          warnGoogleChat("sender_name_unresolved", { sender: userName, status: response.status });
          cache.set(userName, defaultSenderName(sender));
        }
        continue;
      }
      const body = (await response.json()) as {
        responses?: Array<{
          httpStatusCode?: number;
          person?: {
            resourceName?: string;
            names?: Array<{ displayName?: string }>;
            emailAddresses?: Array<{ value?: string }>;
          };
          requestedResourceName?: string;
        }>;
      };
      const byRequested = new Map(
        (body.responses ?? []).map((row) => [row.requestedResourceName ?? "", row]),
      );
      for (const [userName, sender] of chunk) {
        const row = byRequested.get(peopleResourceName(userName));
        const displayName = row?.person ? displayNameFromPerson(row.person) : undefined;
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
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
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
  options: SenderLookupOptions & { onMember?: (resourceName: string) => void } = {},
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  let pageToken: string | undefined;
  let members = 0;
  let named = 0;
  do {
    if (options.shouldContinue && !options.shouldContinue()) break;
    const params = new URLSearchParams({ pageSize: "1000" });
    if (pageToken) params.set("pageToken", pageToken);
    options.onFetch?.();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `https://chat.googleapis.com/v1/${spaceName}/members?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        CHAT_TIMEOUT_MS,
      );
    } catch (error) {
      if (!isNetworkFailure(error)) throw error;
      warnGoogleChat("members_list_failed", { spaceName, retryable: 1 });
      break;
    }
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
      if (!name) continue;
      members += 1;
      options.onMember?.(name);
      if (member?.type === "BOT") {
        cache.set(name, "Bot");
        named += 1;
        continue;
      }
      if (!displayName) continue;
      cache.set(name, displayName);
      named += 1;
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  warnGoogleChat("space_members_listed", { spaceName, members, named });
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
