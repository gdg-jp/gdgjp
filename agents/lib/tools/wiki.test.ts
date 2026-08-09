import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  ALL_CHAPTERS,
  type WikiChapter,
  type WikiToolContext,
  createWikiSession,
  createWikiTools,
  workspacePathToPageUrl,
} from "./wiki";

const WIKI = "https://wiki.gdgs.jp";
const TOKEN = "user-access-token";

function chapters(list: WikiChapter[]): WikiChapter[] {
  return list;
}

function ctx(
  overrides: Partial<WikiToolContext> & { fetch: WikiToolContext["fetch"] },
): WikiToolContext {
  return {
    accessToken: TOKEN,
    wikiApiUrl: WIKI,
    session: createWikiSession(),
    chapters: chapters([{ chapterId: "1", chapterSlug: "osaka", role: "member" }]),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  return vi.fn(impl);
}

describe("createWikiTools", () => {
  it("attaches Authorization: Bearer on every Wiki call", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { path: "/wiki", entries: [], nextCursor: null }),
    );
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    await tools.wiki_ls.execute?.({ path: "/wiki" }, { toolCallId: "1", messages: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it("rejects wiki_search and wiki_cat until /wiki/index has been read", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(200, {}));
    const session = createWikiSession();
    const tools = createWikiTools(ctx({ fetch: fetchMock, session }));

    const searchDenied = await tools.wiki_search.execute?.(
      { q: "umeda" },
      { toolCallId: "1", messages: [] },
    );
    expect(searchDenied).toMatchObject({ error: "index_required" });
    expect(fetchMock).not.toHaveBeenCalled();

    const catDenied = await tools.wiki_cat.execute?.(
      { path: "/wiki/venues/umeda-hall" },
      { toolCallId: "2", messages: [] },
    );
    expect(catDenied).toMatchObject({ error: "index_required" });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { path: "/wiki/index", content: "# Index", nextCursor: null }),
    );
    await tools.wiki_cat.execute?.({ path: "/wiki/index" }, { toolCallId: "3", messages: [] });
    expect(session.indexRead).toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { matches: [], nextCursor: null }));
    await tools.wiki_search.execute?.({ q: "umeda" }, { toolCallId: "4", messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows wiki_ls before the catalog is read", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { path: "/wiki", entries: [], nextCursor: null }),
    );
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    await tools.wiki_ls.execute?.({ path: "/wiki" }, { toolCallId: "1", messages: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("passes paths to wiki_cat verbatim without reconstructing from titles", async () => {
    const fetchMock = mockFetch(async (url: string) => {
      if (String(url).includes("path=%2Fwiki%2Findex")) {
        return jsonResponse(200, { path: "/wiki/index", content: "catalog", nextCursor: null });
      }
      return jsonResponse(200, {
        path: "/wiki/venues/umeda-hall",
        content: "hall",
        nextCursor: null,
      });
    });
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    await tools.wiki_cat.execute?.({ path: "/wiki/index" }, { toolCallId: "1", messages: [] });
    await tools.wiki_cat.execute?.(
      { path: "/wiki/venues/umeda-hall" },
      { toolCallId: "2", messages: [] },
    );
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain("path=%2Fwiki%2Fvenues%2Fumeda-hall");
    expect(secondUrl).not.toContain("Umeda");
  });

  it("surfaces nextCursor without auto-draining pagination", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, {
        path: "/wiki/venues",
        entries: [{ name: "a", path: "/wiki/venues/a", readable: true, hasChildren: false }],
        nextCursor: "page-2",
      }),
    );
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    const result = (await tools.wiki_ls.execute?.(
      { path: "/wiki/venues" },
      { toolCallId: "1", messages: [] },
    )) as { nextCursor: string };
    expect(result.nextCursor).toBe("page-2");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reports 404 as not_found and blocks retry of the same path", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(404, { error: "not_found" }));
    const session = createWikiSession();
    session.indexRead = true;
    const tools = createWikiTools(ctx({ fetch: fetchMock, session }));

    const first = await tools.wiki_cat.execute?.(
      { path: "/wiki/secret" },
      { toolCallId: "1", messages: [] },
    );
    expect(first).toMatchObject({ error: "not_found", path: "/wiki/secret" });

    const second = await tools.wiki_cat.execute?.(
      { path: "/wiki/secret" },
      { toolCallId: "2", messages: [] },
    );
    expect(second).toMatchObject({ error: "not_found" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("flags 401 as needsRelink", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(401, { error: "invalid_token" }));
    const session = createWikiSession();
    session.indexRead = true;
    const tools = createWikiTools(ctx({ fetch: fetchMock, session }));
    const result = await tools.wiki_cat.execute?.(
      { path: "/wiki/venues/x" },
      { toolCallId: "1", messages: [] },
    );
    expect(result).toMatchObject({ error: "invalid_token", needsRelink: true });
  });

  it("wiki_add_source with multi-chapter user and no chapter asks and issues no POST", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(201, { id: "s1" }));
    const tools = createWikiTools(
      ctx({
        fetch: fetchMock,
        chapters: chapters([
          { chapterId: "1", chapterSlug: "osaka", role: "member" },
          { chapterId: "2", chapterSlug: "tokyo", role: "member" },
        ]),
      }),
    );
    const result = await tools.wiki_add_source.execute?.(
      { url: "https://docs.google.com/document/d/abc" },
      { toolCallId: "1", messages: [] },
    );
    expect(result).toMatchObject({ error: "chapter_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wiki_add_source auto-fills chapter when the user belongs to exactly one", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(201, { id: "s1" }));
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    await tools.wiki_add_source.execute?.(
      { url: "https://docs.google.com/document/d/abc" },
      { toolCallId: "1", messages: [] },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toMatchObject({ chapter: "1" });
  });

  it("propagates wiki_add_source 400/403 without retrying another chapter", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(403, { error: "forbidden_chapter" }));
    const tools = createWikiTools(
      ctx({
        fetch: fetchMock,
        chapters: chapters([
          { chapterId: "1", chapterSlug: "osaka", role: "member" },
          { chapterId: "2", chapterSlug: "tokyo", role: "member" },
        ]),
      }),
    );
    const result = await tools.wiki_add_source.execute?.(
      { url: "https://example.com", chapter: "99" },
      { toolCallId: "1", messages: [] },
    );
    expect(result).toMatchObject({ error: "forbidden_chapter", status: 403 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not send ALL_CHAPTERS unless the caller passed it explicitly", async () => {
    const fetchMock = mockFetch(async () => jsonResponse(201, { id: "s1" }));
    const tools = createWikiTools(ctx({ fetch: fetchMock }));
    await tools.wiki_add_source.execute?.(
      { url: "https://example.com", chapter: ALL_CHAPTERS },
      { toolCallId: "1", messages: [] },
    );
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    );
    expect(body.chapter).toBe(ALL_CHAPTERS);
  });

  it("does not share a response cache across callers — each fetch is authorized separately", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(200, { path: "/wiki/index", content: "x", nextCursor: null }),
    );
    const a = createWikiTools(
      ctx({ fetch: fetchMock, accessToken: "token-a", session: createWikiSession() }),
    );
    const b = createWikiTools(
      ctx({ fetch: fetchMock, accessToken: "token-b", session: createWikiSession() }),
    );
    await a.wiki_cat.execute?.({ path: "/wiki/index" }, { toolCallId: "1", messages: [] });
    await b.wiki_cat.execute?.({ path: "/wiki/index" }, { toolCallId: "2", messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: "Bearer token-a",
    });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).toMatchObject({
      Authorization: "Bearer token-b",
    });
  });

  it("builds citation pageUrl from workspace paths", () => {
    expect(workspacePathToPageUrl("/wiki/venues/umeda-hall", WIKI)).toBe(
      "https://wiki.gdgs.jp/wiki/umeda-hall",
    );
  });
});

describe("wiki tools architecture", () => {
  it("does not mention embedding, vector, or VECTORIZE", () => {
    const source = readFileSync(new URL("./wiki.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/embedding|vector|VECTORIZE/i);
  });
});
