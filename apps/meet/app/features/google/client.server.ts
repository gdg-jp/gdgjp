export type GoogleFetch = typeof fetch;

/** Google REST API の HTTP / JSON エラー情報を型付きで保持する例外クラス。 */
export class GoogleApiError extends Error {
  readonly httpStatus: number;
  readonly apiStatus: string | undefined;
  readonly apiMessage: string;
  readonly retryable: boolean;

  constructor(params: { httpStatus: number; apiStatus?: string; apiMessage: string }) {
    super(
      params.apiStatus
        ? `Google API エラー (${params.httpStatus} ${params.apiStatus}): ${params.apiMessage}`
        : `Google API エラー (${params.httpStatus}): ${params.apiMessage}`,
    );
    this.name = "GoogleApiError";
    this.httpStatus = params.httpStatus;
    this.apiStatus = params.apiStatus;
    this.apiMessage = params.apiMessage;
    this.retryable = params.httpStatus === 429 || params.httpStatus >= 500;
  }
}

/** スラッシュ区切りの Google リソース名（例: `spaces/abc`）をセグメント単位で URL エンコードする。 */
export function encodeResourcePath(resourceName: string): string {
  const trimmed = resourceName.replace(/^\/+/, "");
  return trimmed
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function parseGoogleError(
  response: Response,
): Promise<{ apiStatus?: string; apiMessage: string }> {
  const raw = await response.json().catch(() => null);
  if (raw && typeof raw === "object") {
    const root = raw as Record<string, unknown>;
    if (root.error && typeof root.error === "object") {
      const err = root.error as Record<string, unknown>;
      const apiStatus = typeof err.status === "string" ? err.status : undefined;
      const apiMessage =
        typeof err.message === "string" && err.message.length > 0
          ? err.message
          : `HTTP ${response.status}`;
      return { apiStatus, apiMessage };
    }
    if (typeof root.error === "string") {
      const desc = typeof root.error_description === "string" ? root.error_description : root.error;
      return { apiStatus: root.error, apiMessage: desc };
    }
  }
  return { apiMessage: response.statusText || `HTTP ${response.status}` };
}

/** Bearer 認証付きで Google JSON API を呼び出す共通ラッパー。 */
export async function googleJsonRequest<T>(options: {
  accessToken: string;
  url: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  fetchFn?: GoogleFetch;
}): Promise<T> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    Accept: "application/json",
  };
  let serializedBody: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(options.body);
  }

  const response = await fetchFn(options.url, {
    method: options.method ?? "GET",
    headers,
    body: serializedBody,
  });

  if (!response.ok) {
    const parsed = await parseGoogleError(response);
    throw new GoogleApiError({
      httpStatus: response.status,
      apiStatus: parsed.apiStatus,
      apiMessage: parsed.apiMessage,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.trim().length === 0) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

/** `nextPageToken` を自動追従してすべてのページを連結取得するヘルパー。 */
export async function paginateAll<TItem, TPage extends { nextPageToken?: string }>(
  fetchPage: (pageToken?: string) => Promise<TPage>,
  extractItems: (page: TPage) => TItem[] | undefined,
  maxPages = 50,
): Promise<TItem[]> {
  const results: TItem[] = [];
  let pageToken: string | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const page = await fetchPage(pageToken);
    const items = extractItems(page);
    if (items && items.length > 0) {
      results.push(...items);
    }
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return results;
}
