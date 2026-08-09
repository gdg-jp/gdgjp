import { tool } from "ai";
import { z } from "zod";

/** Catalog page — must be read via `wiki_cat` before other cat/search calls. */
export const WIKI_INDEX_PATH = "/wiki/index";

/**
 * Explicit "all chapters" sentinel for `wiki_add_source`.
 * Matches wiki `ALL_CHAPTERS`; never send unless the user chose it.
 */
export const ALL_CHAPTERS = "__all__";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WikiChapter = {
  chapterId: string;
  chapterSlug: string;
  role: string;
};

export type WikiToolSession = {
  indexRead: boolean;
  /** Paths that returned 404 this conversation — do not retry. */
  notFoundPaths: Set<string>;
};

export function createWikiSession(): WikiToolSession {
  return { indexRead: false, notFoundPaths: new Set() };
}

export type WikiToolContext = {
  accessToken: string;
  wikiApiUrl: string;
  /** Origin used to build citation links (defaults to wikiApiUrl). */
  wikiPublicUrl?: string;
  fetch?: FetchLike;
  session: WikiToolSession;
  chapters: readonly WikiChapter[];
};

export type WikiApiErrorBody = {
  error?: string;
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Map a workspace path to the member-facing wiki page URL (leaf slug). */
export function workspacePathToPageUrl(path: string, wikiPublicUrl: string): string {
  const segments = path.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? "";
  return `${trimSlash(wikiPublicUrl)}/wiki/${leaf}`;
}

function requireBearer(accessToken: string): string {
  if (!accessToken) {
    throw new Error("access_token_required");
  }
  return `Bearer ${accessToken}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type WikiHttpResult =
  | { ok: true; status: number; body: unknown }
  | {
      ok: false;
      status: number;
      error: string;
      needsRelink?: boolean;
      body?: unknown;
    };

async function wikiRequest(
  ctx: WikiToolContext,
  pathAndQuery: string,
  init?: RequestInit,
): Promise<WikiHttpResult> {
  const fetchImpl = ctx.fetch ?? fetch;
  const url = `${trimSlash(ctx.wikiApiUrl)}${pathAndQuery}`;
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: requireBearer(ctx.accessToken),
      Accept: "application/json",
    },
  });

  const body = await readJson(response);

  if (response.status === 401) {
    return {
      ok: false,
      status: 401,
      error: "invalid_token",
      needsRelink: true,
      body,
    };
  }

  if (!response.ok) {
    const code =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "request_failed";
    return { ok: false, status: response.status, error: code, body };
  }

  return { ok: true, status: response.status, body };
}

function indexGateError(): {
  error: "index_required";
  message: string;
} {
  return {
    error: "index_required",
    message: `Read ${WIKI_INDEX_PATH} with wiki_cat before wiki_search or other wiki_cat calls.`,
  };
}

function resolveChapterForAdd(
  chapter: string | undefined,
  chapters: readonly WikiChapter[],
):
  | { ok: true; chapter: string }
  | { ok: false; error: "chapter_required"; chapters: { chapterId: string; chapterSlug: string }[] }
  | { ok: false; error: "no_chapter_membership" } {
  if (typeof chapter === "string" && chapter.length > 0) {
    return { ok: true, chapter };
  }
  if (chapters.length === 1) {
    return { ok: true, chapter: chapters[0].chapterId };
  }
  if (chapters.length === 0) {
    return { ok: false, error: "no_chapter_membership" };
  }
  return {
    ok: false,
    error: "chapter_required",
    chapters: chapters.map((c) => ({ chapterId: c.chapterId, chapterSlug: c.chapterSlug })),
  };
}

/**
 * Wiki exploration tools for the Chat agent.
 * Every call uses the linked user's Bearer token; there is no service identity.
 */
export function createWikiTools(ctx: WikiToolContext) {
  const publicUrl = trimSlash(ctx.wikiPublicUrl ?? ctx.wikiApiUrl);

  const wiki_ls = tool({
    description:
      "List a Wiki workspace directory. Start with path `/wiki` for type namespaces, " +
      "or follow paths from the catalog. Prefer wiki_ls over wiki_search when the catalog " +
      "already names the namespace. Pass nextCursor only when you need the next page.",
    inputSchema: z.object({
      path: z.string().optional().describe("Workspace path to list (default `/`)"),
      cursor: z.string().optional().describe("Pagination cursor from a previous wiki_ls"),
      limit: z.number().int().positive().optional(),
    }),
    execute: async ({ path, cursor, limit }, { abortSignal }) => {
      const params = new URLSearchParams();
      if (path !== undefined) params.set("path", path);
      if (cursor !== undefined) params.set("cursor", cursor);
      if (limit !== undefined) params.set("limit", String(limit));
      const qs = params.toString();
      const result = await wikiRequest(ctx, `/api/agent/ls${qs ? `?${qs}` : ""}`, {
        signal: abortSignal,
      });
      if (!result.ok) {
        return {
          error: result.error,
          status: result.status,
          ...(result.needsRelink ? { needsRelink: true } : {}),
        };
      }
      return result.body;
    },
  });

  const wiki_cat = tool({
    description: `Read a Wiki page by workspace path. Paths must come verbatim from wiki_ls or wiki_search (or ${WIKI_INDEX_PATH} for the catalog). Always read ${WIKI_INDEX_PATH} first in a conversation. A 404 means not found or not visible — do not retry or probe.`,
    inputSchema: z.object({
      path: z.string().describe("Workspace path to read, e.g. /wiki/index"),
      cursor: z.string().optional().describe("Pagination cursor from a previous wiki_cat"),
      maxChars: z.number().int().positive().optional(),
    }),
    execute: async ({ path, cursor, maxChars }, { abortSignal }) => {
      if (!ctx.session.indexRead && path !== WIKI_INDEX_PATH) {
        return indexGateError();
      }
      if (ctx.session.notFoundPaths.has(path)) {
        return {
          error: "not_found",
          path,
          message: "This path was already not found; do not retry or probe neighbouring paths.",
        };
      }

      const params = new URLSearchParams({ path });
      if (cursor !== undefined) params.set("cursor", cursor);
      if (maxChars !== undefined) params.set("maxChars", String(maxChars));

      const result = await wikiRequest(ctx, `/api/agent/cat?${params}`, { signal: abortSignal });
      if (!result.ok) {
        if (result.status === 404) {
          ctx.session.notFoundPaths.add(path);
          return {
            error: "not_found",
            path,
            message: "Not found or not visible to this member.",
          };
        }
        return {
          error: result.error,
          status: result.status,
          ...(result.needsRelink ? { needsRelink: true } : {}),
        };
      }

      if (path === WIKI_INDEX_PATH) {
        ctx.session.indexRead = true;
      }

      const body = result.body as { path?: string; content?: string; nextCursor?: string | null };
      return {
        ...body,
        pageUrl: workspacePathToPageUrl(path, publicUrl),
      };
    },
  });

  const wiki_search = tool({
    description: `Search Wiki page titles and bodies. Use only after reading the catalog with wiki_cat on ${WIKI_INDEX_PATH}. Prefer wiki_ls when the catalog already points at the right namespace. Optionally scope with path. Pass nextCursor only when needed.`,
    inputSchema: z.object({
      q: z.string().describe("Search query"),
      path: z.string().optional().describe("Optional subtree scope, e.g. /wiki/venues"),
      cursor: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }),
    execute: async ({ q, path, cursor, limit }, { abortSignal }) => {
      if (!ctx.session.indexRead) {
        return indexGateError();
      }

      const params = new URLSearchParams({ q });
      if (path !== undefined) params.set("path", path);
      if (cursor !== undefined) params.set("cursor", cursor);
      if (limit !== undefined) params.set("limit", String(limit));

      const result = await wikiRequest(ctx, `/api/agent/search?${params}`, { signal: abortSignal });
      if (!result.ok) {
        return {
          error: result.error,
          status: result.status,
          ...(result.needsRelink ? { needsRelink: true } : {}),
        };
      }

      const body = result.body as {
        matches?: { path: string; title: string; snippet?: string }[];
        nextCursor?: string | null;
      };
      const matches = (body.matches ?? []).map((m) => ({
        ...m,
        pageUrl: workspacePathToPageUrl(m.path, publicUrl),
      }));
      return { ...body, matches };
    },
  });

  const wiki_add_source = tool({
    description:
      "Register a URL as a Wiki source (e.g. a Google Doc the user asked to ingest). " +
      "chapter is required: use the chapter id the user chose, or __all__ only when they " +
      "explicitly asked for all chapters. If the user has multiple chapters and has not " +
      "chosen one, ask in Chat — do not call this tool yet.",
    inputSchema: z.object({
      url: z.string().describe("Source URL to register"),
      chapter: z
        .string()
        .optional()
        .describe("Chapter id, or __all__ if the user explicitly chose all chapters"),
      refreshPolicy: z.enum(["manual", "daily", "weekly"]).optional(),
    }),
    execute: async ({ url, chapter, refreshPolicy }, { abortSignal }) => {
      const resolved = resolveChapterForAdd(chapter, ctx.chapters);
      if (!resolved.ok) {
        if (resolved.error === "chapter_required") {
          return {
            error: "chapter_required",
            message:
              "Ask the user which chapter this source belongs to before calling again. " +
              "Do not send __all__ unless they explicitly chose it.",
            chapters: resolved.chapters,
          };
        }
        return {
          error: "no_chapter_membership",
          message: "This account has no chapter membership; cannot register a source.",
        };
      }

      const result = await wikiRequest(ctx, "/api/agent/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          chapter: resolved.chapter,
          ...(refreshPolicy !== undefined ? { refreshPolicy } : {}),
        }),
        signal: abortSignal,
      });

      if (!result.ok) {
        return {
          error: result.error,
          status: result.status,
          ...(result.needsRelink ? { needsRelink: true } : {}),
          // Propagate API 400/403 as-is — do not retry with a different chapter.
        };
      }

      return { ok: true, status: result.status, source: result.body };
    },
  });

  return { wiki_ls, wiki_cat, wiki_search, wiki_add_source };
}

export type WikiTools = ReturnType<typeof createWikiTools>;
