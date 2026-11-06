import { getAuth } from "~/features/auth/auth.server";

export class WikiReadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`wiki ${status} ${code}`);
  }
}

/**
 * Reads the Wiki AS the signed-in user (their GDG Accounts access token), through the WIKI
 * service binding. Only /api/agent/search and /api/agent/cat: pr never writes to the Wiki.
 */
export function wikiReader(env: Env, token: string) {
  const call = async <T>(path: string): Promise<T> => {
    const response = await env.WIKI.fetch(`${env.WIKI_URL}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new WikiReadError(response.status, body.error ?? "request_failed");
    return body;
  };
  return {
    async findPage(title: string): Promise<string | null> {
      const result = await call<{ matches?: { path: string; title: string }[] }>(
        `/api/agent/search?q=${encodeURIComponent(title)}&limit=10`,
      );
      const matches = result.matches ?? [];
      return (matches.find((m) => m.title === title) ?? matches[0])?.path ?? null;
    },
    /** Whole page body, following cursors. */
    async readPage(path: string): Promise<string> {
      let content = "";
      let cursor: string | null = null;
      for (let i = 0; i < 20; i++) {
        const query: string = `path=${encodeURIComponent(path)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const page: { content: string; nextCursor: string | null } = await call(
          `/api/agent/cat?${query}`,
        );
        content += page.content;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return content;
    },
  };
}

export async function wikiReaderForRequest(env: Env, request: Request) {
  return wikiReader(env, await getAuth(env).getAccessToken(request));
}
