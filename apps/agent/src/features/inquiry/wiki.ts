/**
 * The wiki, over the WIKI service binding. The agent Worker only decides WHO it calls as
 * (a linked user's token, or its service token + one guild / chat-space principal); every
 * permission decision and every redaction happens in the wiki.
 */
export type Reader =
  | { kind: "user"; token: string }
  | { kind: "principal"; type: "discord_guild" | "chat_space"; id: string }
  | { kind: "anonymous" };

export type SearchPage = {
  space: string;
  slug: string;
  title: string;
  url: string;
  snippets: string[];
};
export type SearchRaw = {
  space: string;
  sourceId: string;
  title: string;
  source: string;
  url: string | null;
  snippet: string;
};
export type SearchResult = {
  spaces: string[];
  truncatedSpaces: boolean;
  pages: SearchPage[];
  raw: SearchRaw[];
};
export type PageRead = { space: string; slug: string; title: string; url: string; content: string };
export type SpaceSummary = { id: string; slug: string; name: string; kind: string; role: string };
export type AnswerJob = { jobId: string; deadlineAt: number };

export class WikiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`wiki ${status} ${code}`);
  }
}

export type WikiClient = {
  search(reader: Reader, query: string, spaces: readonly string[]): Promise<SearchResult>;
  page(reader: Reader, space: string, slug: string): Promise<PageRead | null>;
  spaces(reader: Reader): Promise<SpaceSummary[]>;
  addSpaceMember(
    token: string,
    space: string,
    principalType: "discord_guild" | "chat_space",
    principalId: string,
  ): Promise<void>;
  enqueueAnswer(
    reader: Reader,
    input: { question: string; spaces: readonly string[]; bundle: Record<string, string> },
  ): Promise<AnswerJob>;
  expireJob(jobId: string): Promise<void>;
  runnerLastSeen(): Promise<number | null>;
  postNote(token: string, note: Record<string, unknown>): Promise<{ ok: boolean; status: number }>;
};

export function wikiClient(
  binding: Fetcher,
  serviceToken: string,
  origin = "https://wiki.gdgs.jp",
): WikiClient {
  function headers(reader: Reader | { kind: "service" }): Headers {
    const out = new Headers({ accept: "application/json" });
    if (reader.kind === "user") {
      out.set("authorization", `Bearer ${reader.token}`);
    } else {
      out.set("authorization", `Bearer ${serviceToken}`);
      if (reader.kind === "principal") out.set("x-agent-principal", `${reader.type}:${reader.id}`);
    }
    return out;
  }
  async function call<T>(
    path: string,
    reader: Reader | { kind: "service" },
    init: RequestInit = {},
    service = false,
  ): Promise<T> {
    const h = headers(reader);
    if (service) h.set("x-agent-service-token", serviceToken);
    if (init.body) h.set("content-type", "application/json");
    const response = await binding.fetch(`${origin}${path}`, { ...init, headers: h });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new WikiError(response.status, body.error ?? "request_failed");
    return body;
  }
  return {
    search(reader, query, spaces) {
      const params = new URLSearchParams({ q: query, layers: "page,acl,raw", limit: "12" });
      if (spaces.length > 0) params.set("space", spaces.join(","));
      return call(`/api/agent/knowledge-search?${params}`, reader);
    },
    async page(reader, space, slug) {
      try {
        return await call<PageRead>(
          `/api/agent/page?${new URLSearchParams({ space, slug })}`,
          reader,
        );
      } catch (error) {
        if (error instanceof WikiError && error.status === 404) return null;
        throw error;
      }
    },
    async spaces(reader) {
      return (await call<{ spaces: SpaceSummary[] }>("/api/agent/spaces", reader)).spaces;
    },
    async addSpaceMember(token, space, principalType, principalId) {
      await call(
        `/api/agent/spaces/${encodeURIComponent(space)}/members`,
        { kind: "user", token },
        {
          method: "POST",
          body: JSON.stringify({ principalType, principalId }),
        },
      );
    },
    enqueueAnswer(reader, input) {
      return call(
        "/api/agent/jobs/answer",
        reader,
        { method: "POST", body: JSON.stringify(input) },
        true,
      );
    },
    async expireJob(jobId) {
      await call(
        `/api/agent/jobs/${encodeURIComponent(jobId)}/expire`,
        { kind: "service" },
        { method: "POST", body: "{}" },
        true,
      );
    },
    async runnerLastSeen() {
      const body = await call<{ lastSeenAt: number | null }>(
        "/api/agent/runner-status",
        { kind: "service" },
        {},
        true,
      );
      return body.lastSeenAt;
    },
    async postNote(token, note) {
      try {
        await call(
          "/api/agent/notes",
          { kind: "user", token },
          { method: "POST", body: JSON.stringify(note) },
        );
        return { ok: true, status: 200 };
      } catch (error) {
        return { ok: false, status: error instanceof WikiError ? error.status : 0 };
      }
    },
  };
}
