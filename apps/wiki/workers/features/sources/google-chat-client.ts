import type { ChatMessage } from "./google-chat-normalize";
import { threadParentText } from "./google-chat-normalize";

const CHAT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 1000;

export const GOOGLE_CHAT_REAUTH_MESSAGE =
  "Google Chat or Drive scopes are missing. Disconnect and reconnect Google from /sources to grant the required access.";

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
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
