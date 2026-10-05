/**
 * Google Chat API helpers used from React Router loaders (Space picker).
 * Message fetch/normalization lives in workers/features/sources/google-chat.ts.
 */

const CHAT_TIMEOUT_MS = 30_000;

export interface ChatSpace {
  name: string;
  displayName?: string;
  spaceType?: string;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

/** Paginate spaces.list for the Space-selection UI. */
export async function listGoogleChatSpaces(accessToken: string): Promise<ChatSpace[]> {
  const spaces: ChatSpace[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetchWithTimeout(
      `https://chat.googleapis.com/v1/spaces?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      CHAT_TIMEOUT_MS,
    );
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Google Chat spaces.list failed (${response.status}): ${err}`);
    }
    const body = (await response.json()) as {
      spaces?: ChatSpace[];
      nextPageToken?: string;
    };
    if (body.spaces) spaces.push(...body.spaces);
    pageToken = body.nextPageToken;
  } while (pageToken);

  return spaces;
}
