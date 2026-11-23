import { type McpServer, requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WIKI_READ, WIKI_WRITE } from "../oauth/scopes";
import { WikiApiError, type WikiBinary, type WikiClient } from "./client";

const DEFAULT_SPACE = "gdg-jp";
const DEFAULT_MAX_CHARS = 60_000;
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

const SOURCE_VISIBILITY = z
  .enum(["private", "member", "organizer", "chapter-member", "chapter-organizer"])
  .describe(
    "Who can read the source: private (you), member / organizer (any chapter's), or chapter-member / chapter-organizer (one chapter's, set `chapter`).",
  );

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType: string; blob: string } }
  >;
  isError?: boolean;
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

function json(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const ERROR_HINTS: Record<number, string> = {
  401: "GDG Japan Accounts のトークンが無効です。MCP クライアントで GDG Japan MCP に接続し直してください。",
  403: "あなたの権限ではこの操作はできません。",
  404: "見つかりません（存在しないか、あなたには見えません）。",
  409: "競合しました。最新の状態を読み直してからやり直してください。",
  503: "wiki 側の機能が一時的に使えません。",
};

function failure(error: unknown): ToolResult {
  if (error instanceof WikiApiError) {
    const hint = ERROR_HINTS[error.status] ?? "wiki がエラーを返しました。";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `${hint}\nwiki ${error.status}: ${error.code}${
            error.body ? `\n${JSON.stringify(error.body)}` : ""
          }`,
        },
      ],
    };
  }
  throw error;
}

async function run(action: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await action();
  } catch (error) {
    return failure(error);
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isTextual(contentType: string): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type.endsWith("+json") ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/x-ndjson"
  );
}

function clip(text: string, maxChars: number): { text: string; truncated: boolean } {
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

function binaryResult(file: WikiBinary, uri: string, maxChars: number): ToolResult {
  const mimeType = file.contentType.split(";")[0]?.trim() || "application/octet-stream";
  if (isTextual(file.contentType)) {
    const { text, truncated } = clip(new TextDecoder().decode(file.bytes), maxChars);
    const note = truncated
      ? `\n\n[${maxChars} 文字で切りました。全体は ${file.bytes.length} バイト。maxChars を増やすと続きを読めます]`
      : "";
    return { content: [{ type: "text", text: `${text}${note}` }] };
  }
  if (file.bytes.length > MAX_INLINE_BYTES) {
    return {
      content: [
        {
          type: "text",
          text: `${mimeType} のファイル（${file.bytes.length} バイト）は大きすぎて返せません。`,
        },
      ],
    };
  }
  if (mimeType.startsWith("image/")) {
    return { content: [{ type: "image", data: base64(file.bytes), mimeType }] };
  }
  return { content: [{ type: "resource", resource: { uri, mimeType, blob: base64(file.bytes) } }] };
}

export function registerWikiTools(
  server: McpServer,
  wiki: WikiClient,
  options: { wikiOrigin: string },
): void {
  const writeChallenge = requireScopes(WIKI_READ, WIKI_WRITE);
  const readChallenge = requireScopes(WIKI_READ);

  server.registerTool(
    "wiki_list_spaces",
    {
      title: "List wiki spaces",
      description:
        "List the wiki spaces you can reach and your role in each. Space slugs are used by the other tools (`gdg-jp` is the GDG Japan wide space).",
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    () => run(async () => json(await wiki.getJson("/api/agent/spaces"))),
  );

  server.registerTool(
    "wiki_search",
    {
      title: "Search the wiki",
      description:
        "Semantic search over wiki pages (and optionally raw sources) you can read. Returns pages with space, slug, url and matching snippets; read a hit with wiki_read_page. `excludedPages` counts matches hidden from you by access rules.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Natural-language question or keywords."),
        spaces: z
          .array(z.string().min(1))
          .optional()
          .describe("Space slugs to search. Omit for every space you can reach."),
        layers: z
          .array(z.enum(["page", "acl", "raw"]))
          .optional()
          .describe("`page` and `acl` search pages (default); add `raw` for source documents."),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ query, spaces, layers, limit }) =>
      run(async () =>
        json(
          await wiki.getJson("/api/agent/knowledge-search", {
            q: query,
            space: spaces?.join(","),
            layers: layers?.join(","),
            limit: limit?.toString(),
          }),
        ),
      ),
  );

  server.registerTool(
    "wiki_read_page",
    {
      title: "Read a wiki page",
      description:
        "Read one published page as Markdown, redacted to what you may see. Use the space and slug from wiki_search or wiki_list_spaces.",
      inputSchema: z.object({
        space: z.string().min(1).describe("Space slug, e.g. `gdg-jp`."),
        slug: z.string().min(1).describe("Page slug within the space."),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ space, slug }) =>
      run(async () => json(await wiki.getJson("/api/agent/page", { space, slug }))),
  );

  server.registerTool(
    "wiki_ls",
    {
      title: "List a workspace directory",
      description:
        "Browse the wiki as a file tree (the agent workspace): list entries under an absolute path such as `/` or `/wiki`. Page with `cursor` when `truncated` is true.",
      inputSchema: z.object({
        path: z.string().optional().describe("Absolute workspace path. Defaults to `/`."),
        limit: z.number().int().min(1).optional(),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ path, limit, cursor }) =>
      run(async () =>
        json(
          await wiki.getJson("/api/agent/ls", {
            path: path ?? "/",
            limit: limit?.toString(),
            cursor,
          }),
        ),
      ),
  );

  server.registerTool(
    "wiki_cat",
    {
      title: "Read a workspace file",
      description:
        "Read a page from the agent workspace by absolute path (from wiki_ls or wiki_grep). Long pages come in slices: pass `nextCursor` back as `cursor`.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute workspace path."),
        maxChars: z.number().int().min(1).optional(),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ path, maxChars, cursor }) =>
      run(async () =>
        json(
          await wiki.getJson("/api/agent/cat", {
            path,
            maxChars: maxChars?.toString(),
            cursor,
          }),
        ),
      ),
  );

  server.registerTool(
    "wiki_grep",
    {
      title: "Find pages by text",
      description:
        "Literal title / slug / body search in the agent workspace, optionally under one path. Use wiki_search for questions; use this for exact names and phrases.",
      inputSchema: z.object({
        query: z.string().min(1),
        path: z.string().optional().describe("Absolute path to search under."),
        limit: z.number().int().min(1).optional(),
        cursor: z.string().optional(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ query, path, limit, cursor }) =>
      run(async () =>
        json(
          await wiki.getJson("/api/agent/search", {
            q: query,
            path,
            limit: limit?.toString(),
            cursor,
          }),
        ),
      ),
  );

  server.registerTool(
    "wiki_list_sources",
    {
      title: "List raw sources",
      description:
        "The raw-source manifest of a space (what `gdg wiki raw pull` downloads): Google Docs, chats, websites and human pages the wiki is built from. Filter with `query`; read one with wiki_read_source.",
      inputSchema: z.object({
        space: z
          .string()
          .min(1)
          .optional()
          .describe(`Space slug. Defaults to \`${DEFAULT_SPACE}\`.`),
        lang: z.enum(["ja", "en"]).optional(),
        query: z
          .string()
          .optional()
          .describe("Case-insensitive substring matched against title and path."),
        limit: z.number().int().min(1).max(1000).optional().describe("Defaults to 100."),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ space, lang, query, limit }) =>
      run(async () => {
        const manifest = await wiki.getJson<{ documents?: Array<Record<string, unknown>> }>(
          "/api/cli/wiki/sources",
          { space: space ?? DEFAULT_SPACE, lang },
        );
        const all = manifest.documents ?? [];
        const needle = query?.toLowerCase();
        const matched = needle
          ? all.filter((entry) =>
              [entry.title, entry.path].some(
                (field) => typeof field === "string" && field.toLowerCase().includes(needle),
              ),
            )
          : all;
        const max = limit ?? 100;
        return json({
          total: all.length,
          matched: matched.length,
          truncated: matched.length > max,
          documents: matched.slice(0, max),
        });
      }),
  );

  server.registerTool(
    "wiki_read_source",
    {
      title: "Read a raw source",
      description:
        "Read one raw source document by `documentId` from wiki_list_sources. Text comes back as text (clipped at `maxChars`); images and PDFs come back as files.",
      inputSchema: z.object({
        documentId: z.string().min(1),
        lang: z.enum(["ja", "en"]).optional(),
        maxChars: z.number().int().min(1).optional(),
      }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ documentId, lang, maxChars }) =>
      run(async () => {
        const path = `/api/cli/wiki/sources/${encodeURIComponent(documentId)}/content`;
        const file = await wiki.getBinary(path, { lang });
        return binaryResult(file, `${options.wikiOrigin}${path}`, maxChars ?? DEFAULT_MAX_CHARS);
      }),
  );

  server.registerTool(
    "wiki_download_attachment",
    {
      title: "Download a page attachment",
      description: "Download a page attachment by id (from a page's attachments) that you can see.",
      inputSchema: z.object({ attachmentId: z.string().min(1) }),
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    ({ attachmentId }) =>
      run(async () => {
        const path = `/api/cli/wiki/attachments/${encodeURIComponent(attachmentId)}`;
        const file = await wiki.getBinary(path);
        return binaryResult(file, `${options.wikiOrigin}${path}`, DEFAULT_MAX_CHARS);
      }),
  );

  server.registerTool(
    "wiki_get_agents_md",
    {
      title: "Read AGENTS.md",
      description:
        "The centrally managed AGENTS.md: how the wiki is organised and how agents write it. Returns its `contentHash`, which wiki_update_agents_md needs.",
      annotations: READ_ONLY,
      scopeChallenge: readChallenge,
    },
    () =>
      run(async () => {
        const file = await wiki.getBinary("/api/cli/wiki/agents-md");
        return json({
          contentHash: file.etag?.replace(/^W\//, "").replace(/"/g, "") ?? null,
          content: new TextDecoder().decode(file.bytes),
        });
      }),
  );

  server.registerTool(
    "wiki_add_source",
    {
      title: "Register a source",
      description:
        "Add a URL (Google Docs / Sheets / Slides, Google Chat space, Discord channel, website) to a space as yourself; the knowledge runner then reads it into pages. You need editor access to the space and must be able to read the URL.",
      inputSchema: z.object({
        space: z
          .string()
          .min(1)
          .optional()
          .describe(`Space slug. Defaults to \`${DEFAULT_SPACE}\`.`),
        url: z.url(),
        visibility: SOURCE_VISIBILITY,
        chapter: z
          .string()
          .optional()
          .describe("Chapter id, required for chapter-member / chapter-organizer."),
        refreshPolicy: z.enum(["manual", "daily", "weekly"]).optional(),
      }),
      annotations: WRITES,
      scopeChallenge: writeChallenge,
    },
    ({ space, url, visibility, chapter, refreshPolicy }) =>
      run(async () => {
        const { body } = await wiki.postJson(
          "/api/agent/sources",
          { url, visibility, chapter, refreshPolicy },
          { space: space ?? DEFAULT_SPACE },
        );
        return json(body);
      }),
  );

  server.registerTool(
    "wiki_add_inline_source",
    {
      title: "Register text as a source",
      description:
        "Save Markdown (a conversation log, meeting notes, a write-up) as a raw source owned by you, up to 1 MB. `externalId` makes retries safe; reusing it for different content is refused.",
      inputSchema: z.object({
        title: z.string().optional().describe("Display title. Defaults to `Conversation`."),
        content: z.string().min(1).describe("Markdown body."),
        visibility: SOURCE_VISIBILITY,
        chapter: z.string().optional(),
        externalId: z.string().optional().describe("Idempotency key for retries."),
      }),
      annotations: WRITES,
      scopeChallenge: writeChallenge,
    },
    (input) =>
      run(async () => json((await wiki.postJson("/api/agent/sources/inline", input)).body)),
  );

  server.registerTool(
    "wiki_file_answer",
    {
      title: "File an answer note",
      description:
        "File a reusable answer under the wiki's answers namespace, citing 2–12 workspace paths you read. Visibility and chapter come from the citations. Pass `replaceId` to replace your earlier note. Follow the citation and sensitive-information rules in wiki_get_agents_md.",
      inputSchema: z.object({
        slug: z
          .string()
          .max(160)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        title: z.string().max(200),
        summary: z.string().max(300),
        content: z.string().max(8000).describe("Markdown answer."),
        citedPaths: z.array(z.string()).min(2).max(12),
        replaceId: z.string().optional(),
      }),
      annotations: WRITES,
      scopeChallenge: writeChallenge,
    },
    (input) => run(async () => json((await wiki.postJson("/api/agent/notes", input)).body)),
  );

  server.registerTool(
    "wiki_append_log",
    {
      title: "Append to the query log",
      description: "Append a short entry (subject + 1–8 lines) to the wiki's query log.",
      inputSchema: z.object({
        subject: z.string().max(200),
        lines: z.array(z.string().max(200)).min(1).max(8),
      }),
      annotations: WRITES,
      scopeChallenge: writeChallenge,
    },
    (input) =>
      run(async () => {
        await wiki.postJson("/api/agent/log", input);
        return json({ ok: true });
      }),
  );

  server.registerTool(
    "wiki_update_agents_md",
    {
      title: "Update AGENTS.md",
      description:
        "Replace AGENTS.md (wiki administrators only). Pass the `contentHash` from wiki_get_agents_md; a stale hash is refused so concurrent edits are not lost.",
      inputSchema: z.object({
        content: z.string().min(1).max(262_144),
        expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      scopeChallenge: writeChallenge,
    },
    ({ content, expectedContentHash }) =>
      run(async () => {
        const { body } = await wiki.postJson(
          "/api/cli/wiki/sync",
          { operations: [], agentsMd: { content, expectedContentHash } },
          { space: DEFAULT_SPACE },
        );
        return json(body);
      }),
  );
}
