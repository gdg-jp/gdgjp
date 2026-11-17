/**
 * The wiki's Bearer API, called as the signed-in person with their GDG Japan Accounts token.
 * This Worker never decides who may see what: spaces, page ACLs and redaction are the
 * wiki's, exactly as for `gdg wiki` (CLI) and the agent Worker.
 */
export class WikiApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`wiki ${status} ${code}`);
  }
}

export type WikiBinary = { contentType: string; bytes: Uint8Array; etag: string | null };

export type WikiClient = {
  getJson<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<T>;
  postJson<T = unknown>(
    path: string,
    body: unknown,
    query?: Record<string, string | undefined>,
  ): Promise<{ status: number; body: T }>;
  getBinary(path: string, query?: Record<string, string | undefined>): Promise<WikiBinary>;
};

export function wikiClient(input: {
  /** The WIKI service binding, or global fetch in local dev. */
  fetcher: { fetch(input: string, init?: RequestInit): Promise<Response> };
  origin: string;
  accessToken: string;
}): WikiClient {
  const origin = input.origin.replace(/\/+$/, "");

  function url(path: string, query?: Record<string, string | undefined>): string {
    const target = new URL(`${origin}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== "") target.searchParams.set(key, value);
    }
    return target.toString();
  }

  async function send(target: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${input.accessToken}`);
    const response = await input.fetcher.fetch(target, { ...init, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const code =
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "request_failed";
      throw new WikiApiError(response.status, code, body);
    }
    return response;
  }

  return {
    async getJson(path, query) {
      const response = await send(url(path, query), { headers: { accept: "application/json" } });
      return response.json();
    },
    async postJson(path, body, query) {
      const response = await send(url(path, query), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    async getBinary(path, query) {
      const response = await send(url(path, query));
      return {
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        bytes: new Uint8Array(await response.arrayBuffer()),
        etag: response.headers.get("etag"),
      };
    },
  };
}
