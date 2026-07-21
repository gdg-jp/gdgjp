import { and, asc, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { tiptapToMarkdown } from "~/lib/tiptap-convert";

/**
 * A deliberately small, read-only filesystem facade for generation agents.
 *
 * The facade never materialises the wiki. Directories are resolved one slug at
 * a time and page bodies are only fetched by `cat`/`grep` after authorization.
 * This is the boundary which prevents a growing wiki from becoming prompt
 * context by accident.
 */

type Db = DrizzleD1Database<typeof schema>;

export const WIKI_WORKSPACE_LIMITS = {
  maxDirectoryEntries: 50,
  defaultDirectoryEntries: 25,
  maxFindResults: 20,
  maxGrepResults: 12,
  maxCatLines: 400,
  maxToolOutputTokens: 2_000,
  defaultBudgetTokens: 16_000,
  maxPathDepth: 16,
  maxQueryLength: 160,
} as const;

export type WorkspaceActor = {
  userId: string;
  email?: string | null;
  isAdmin: boolean;
  chapterIds: readonly string[];
};

export type SourceFile = {
  /** File name only. It is exposed under /sources. */
  name: string;
  /** Source loading is deliberately deferred until the file is read. */
  load: () => Promise<string>;
};

export type WorkspacePage = {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  summaryJa: string;
  summaryEn: string;
  parentId: string | null;
  status: string;
  pageType: string | null;
  pageMetadata: string | null;
  visibility: string;
  generalRole: string | null;
  chapterId: string | null;
  authorId: string;
  updatedAt: Date;
};

type WorkspacePageBody = WorkspacePage & {
  contentJa: string;
  contentEn: string;
  tags: string[];
};

type StoreListOptions = { limit: number; offset: number };

/**
 * Kept as an interface so the tool contract can be unit-tested without a D1
 * emulator. The production implementation below maps each operation to a
 * bounded D1 query.
 */
export interface WikiWorkspaceStore {
  getRootPage(slug: string): Promise<WorkspacePage | null>;
  getChildPage(parentId: string, slug: string): Promise<WorkspacePage | null>;
  getPageById(id: string): Promise<WorkspacePage | null>;
  getPageBody(id: string): Promise<WorkspacePageBody | null>;
  listChildren(parentId: string | null, options: StoreListOptions): Promise<WorkspacePage[]>;
  findPublicPages(query: string, options: StoreListOptions): Promise<WorkspacePage[]>;
  grepPublicPages(query: string, options: StoreListOptions): Promise<WorkspacePageBody[]>;
  canView(page: WorkspacePage): Promise<boolean>;
}

export type WorkspaceTrace = {
  tool: "pwd" | "cd" | "ls" | "cat" | "find" | "grep";
  path?: string;
  query?: string;
  outputTokens: number;
  truncated: boolean;
  at: string;
};

export type WorkspaceManifest = {
  version: 1;
  budget: { maxTokens: number; consumedTokens: number; remainingTokens: number };
  references: Array<{ path: string; lineStart?: number; lineEnd?: number }>;
  tools: WorkspaceTrace[];
};

export type WorkspaceResult<T> = {
  data: T;
  truncated: boolean;
  manifest: WorkspaceManifest;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type ListResult = { cwd: string; entries: DirectoryEntry[]; nextCursor: string | null };
export type CatResult = { path: string; content: string; lineStart: number; lineEnd: number };
export type FindResult = { path: string; title: string; pageId: string };
export type GrepResult = { path: string; line: number; text: string };

type Cursor = { offset: number };

function tokenEstimate(value: string): number {
  // The budget is a defensive ceiling, not billing telemetry. A conservative
  // approximation works consistently for Japanese and Latin text in Workers.
  return Math.max(1, Math.ceil(value.length / 3));
}

function serialise(value: unknown): string {
  return JSON.stringify(value);
}

/** Keep returned values structurally valid when a shared tool budget is low. */
function fitToolOutput<T>(data: T, maxCharacters: number): { data: T; truncated: boolean } {
  if (serialise(data).length <= maxCharacters) return { data, truncated: false };
  if (Array.isArray(data)) {
    const items: unknown[] = [];
    for (const item of data) {
      if (serialise([...items, item]).length > maxCharacters) break;
      items.push(item);
    }
    return { data: items as T, truncated: true };
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.content === "string") {
      const empty = serialise({ ...record, content: "" }).length;
      return {
        data: {
          ...record,
          content: record.content.slice(0, Math.max(0, maxCharacters - empty)),
        } as T,
        truncated: true,
      };
    }
    if (Array.isArray(record.entries)) {
      const entries: unknown[] = [];
      for (const entry of record.entries) {
        if (serialise({ ...record, entries: [...entries, entry] }).length > maxCharacters) break;
        entries.push(entry);
      }
      return { data: { ...record, entries } as T, truncated: true };
    }
  }
  // All workspace results are arrays or records above. Keep this fallback
  // opaque rather than exposing a partially serialised JSON value.
  return { data, truncated: true };
}

export class WorkspaceBudgetExceededError extends Error {
  constructor() {
    super("Wiki workspace token budget exhausted");
    this.name = "WorkspaceBudgetExceededError";
  }
}

function normaliseSourceName(name: string): string {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error("Invalid workspace source filename");
  }
  return name;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(atob(cursor)) as Cursor;
    return Number.isSafeInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    throw new Error("Invalid workspace cursor");
  }
}

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset } satisfies Cursor));
}

function boundedLimit(value: number | undefined, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid workspace limit");
  return Math.min(value, maximum);
}

function cleanQuery(query: string): string {
  const cleaned = query.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("Workspace query must not be empty");
  return cleaned.slice(0, WIKI_WORKSPACE_LIMITS.maxQueryLength);
}

/** Reject traversal rather than silently normalising it. */
export function normaliseWorkspacePath(input: string, cwd = "/"): string {
  if (!input || input.includes("\\") || input.includes("\0"))
    throw new Error("Invalid workspace path");
  const absolute = input.startsWith("/") ? input : `${cwd}/${input}`;
  const segments = absolute.split("/").filter(Boolean);
  if (segments.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("Workspace path traversal is not allowed");
  }
  return `/${segments.join("/")}` || "/";
}

function parseMarkdownPath(path: string): { directory: string; language: "ja" | "en" } | null {
  const match = path.match(/^(.*)\/index\.(ja|en)\.md$/);
  return match ? { directory: match[1] || "/", language: match[2] as "ja" | "en" } : null;
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

function formatPage(page: WorkspacePageBody, language: "ja" | "en"): string {
  const title = language === "ja" ? page.titleJa : page.titleEn || page.titleJa;
  const summary = language === "ja" ? page.summaryJa : page.summaryEn || page.summaryJa;
  const body = language === "ja" ? page.contentJa : page.contentEn || page.contentJa;
  const metadata = page.pageMetadata ? page.pageMetadata : "{}";
  return [
    "---",
    `id: ${yaml(page.id)}`,
    `slug: ${yaml(page.slug)}`,
    `parentId: ${page.parentId ? yaml(page.parentId) : "null"}`,
    `title: ${yaml(title)}`,
    `summary: ${yaml(summary)}`,
    `pageType: ${page.pageType ? yaml(page.pageType) : "null"}`,
    `tags: [${page.tags.map(yaml).join(", ")}]`,
    `updatedAt: ${yaml(page.updatedAt.toISOString())}`,
    `metadata: ${metadata}`,
    "---",
    "",
    tiptapToMarkdown(body),
  ].join("\n");
}

export class WikiWorkspace {
  #cwd = "/";
  #consumedTokens = 0;
  #references: WorkspaceManifest["references"] = [];
  #tools: WorkspaceTrace[] = [];
  #sourceByName: Map<string, SourceFile>;

  constructor(
    private readonly store: WikiWorkspaceStore,
    sourceFiles: readonly SourceFile[] = [],
    private readonly maxTokens: number = WIKI_WORKSPACE_LIMITS.defaultBudgetTokens,
  ) {
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1)
      throw new Error("Invalid workspace budget");
    this.#sourceByName = new Map(
      sourceFiles.map((source) => [normaliseSourceName(source.name), source]),
    );
    if (this.#sourceByName.size !== sourceFiles.length)
      throw new Error("Duplicate workspace source filename");
  }

  manifest(): WorkspaceManifest {
    return {
      version: 1,
      budget: {
        maxTokens: this.maxTokens,
        consumedTokens: this.#consumedTokens,
        remainingTokens: Math.max(0, this.maxTokens - this.#consumedTokens),
      },
      references: [...this.#references],
      tools: [...this.#tools],
    };
  }

  async pwd(): Promise<WorkspaceResult<{ path: string }>> {
    return this.record("pwd", { path: this.#cwd }, { path: this.#cwd });
  }

  async cd(input: string): Promise<WorkspaceResult<{ path: string }>> {
    const path = normaliseWorkspacePath(input, this.#cwd);
    await this.assertDirectory(path);
    this.#cwd = path;
    return this.record("cd", { path }, { path });
  }

  async ls(
    input = ".",
    options: { limit?: number; cursor?: string } = {},
  ): Promise<WorkspaceResult<ListResult>> {
    const path = normaliseWorkspacePath(input, this.#cwd);
    const limit = boundedLimit(
      options.limit,
      WIKI_WORKSPACE_LIMITS.maxDirectoryEntries,
      WIKI_WORKSPACE_LIMITS.defaultDirectoryEntries,
    );
    const offset = decodeCursor(options.cursor);
    const entries: DirectoryEntry[] = [];

    if (path === "/") {
      entries.push(
        { name: "sources", path: "/sources", type: "directory" },
        { name: "wiki", path: "/wiki", type: "directory" },
      );
      return this.record("ls", { path }, { cwd: path, entries, nextCursor: null });
    }
    if (path === "/sources") {
      const sourceEntries = [...this.#sourceByName.keys()]
        .sort()
        .slice(offset, offset + limit)
        .map((name) => ({ name, path: `/sources/${name}`, type: "file" as const }));
      entries.push(...sourceEntries);
      return this.record(
        "ls",
        { path },
        {
          cwd: path,
          entries,
          nextCursor:
            offset + sourceEntries.length < this.#sourceByName.size
              ? encodeCursor(offset + sourceEntries.length)
              : null,
        },
      );
    }

    const directory = await this.resolveWikiDirectory(path);
    // Discovery intentionally exposes public pages only. Restricted and
    // unlisted pages can still be opened through an authorized exact path.
    const candidates = await this.store.listChildren(directory?.id ?? null, {
      limit: limit + 1,
      offset,
    });
    for (const page of candidates.slice(0, limit)) {
      if (page.status !== "published" || page.visibility !== "public") continue;
      const pagePath = await this.pathForPage(page);
      entries.push({ name: page.slug, path: pagePath, type: "directory" });
    }
    const hasMore = candidates.length > limit;
    return this.record(
      "ls",
      { path },
      {
        cwd: path,
        entries,
        nextCursor: hasMore ? encodeCursor(offset + limit) : null,
      },
    );
  }

  async cat(
    input: string,
    options: { startLine?: number; endLine?: number } = {},
  ): Promise<WorkspaceResult<CatResult>> {
    const path = normaliseWorkspacePath(input, this.#cwd);
    const source = this.sourceForPath(path);
    if (source) {
      const content = await source.load();
      return this.catContent(path, content, options);
    }
    const markdown = parseMarkdownPath(path);
    if (!markdown) throw new Error("cat only accepts a source file or index.ja.md/index.en.md");
    const page = await this.resolveWikiDirectory(markdown.directory);
    if (!page || !(await this.store.canView(page))) throw new Error("Workspace file not found");
    const body = await this.store.getPageBody(page.id);
    if (!body) throw new Error("Workspace file not found");
    return this.catContent(path, formatPage(body, markdown.language), options);
  }

  async find(
    query: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<WorkspaceResult<FindResult[]>> {
    const clean = cleanQuery(query);
    const limit = boundedLimit(
      options.limit,
      WIKI_WORKSPACE_LIMITS.maxFindResults,
      WIKI_WORKSPACE_LIMITS.maxFindResults,
    );
    const offset = decodeCursor(options.cursor);
    const pages = await this.store.findPublicPages(clean, { limit, offset });
    const data: FindResult[] = [];
    for (const page of pages) {
      const path = `${await this.pathForPage(page)}/index.ja.md`;
      data.push({ path, title: page.titleJa || page.titleEn, pageId: page.id });
    }
    return this.record("find", { query: clean }, data);
  }

  async grep(
    query: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<WorkspaceResult<GrepResult[]>> {
    const clean = cleanQuery(query);
    const limit = boundedLimit(
      options.limit,
      WIKI_WORKSPACE_LIMITS.maxGrepResults,
      WIKI_WORKSPACE_LIMITS.maxGrepResults,
    );
    const offset = decodeCursor(options.cursor);
    const pages = await this.store.grepPublicPages(clean, { limit, offset });
    const matches: GrepResult[] = [];
    for (const page of pages) {
      const path = `${await this.pathForPage(page)}/index.ja.md`;
      for (const [index, line] of formatPage(page, "ja").split("\n").entries()) {
        if (line.toLocaleLowerCase().includes(clean.toLocaleLowerCase())) {
          matches.push({ path, line: index + 1, text: line.slice(0, 500) });
          if (matches.length === limit) return this.record("grep", { query: clean }, matches);
        }
      }
    }
    return this.record("grep", { query: clean }, matches);
  }

  private async catContent(
    path: string,
    content: string,
    options: { startLine?: number; endLine?: number },
  ): Promise<WorkspaceResult<CatResult>> {
    const lines = content.split("\n");
    const startLine = options.startLine ?? 1;
    const requestedEnd = options.endLine ?? startLine + WIKI_WORKSPACE_LIMITS.maxCatLines - 1;
    if (
      !Number.isSafeInteger(startLine) ||
      !Number.isSafeInteger(requestedEnd) ||
      startLine < 1 ||
      requestedEnd < startLine
    ) {
      throw new Error("Invalid line range");
    }
    const endLine = Math.min(
      lines.length,
      requestedEnd,
      startLine + WIKI_WORKSPACE_LIMITS.maxCatLines - 1,
    );
    const unboundedContent = lines.slice(startLine - 1, endLine).join("\n");
    const remaining = Math.max(0, this.maxTokens - this.#consumedTokens);
    const contentLimit = Math.min(WIKI_WORKSPACE_LIMITS.maxToolOutputTokens, remaining) * 3;
    const boundedContent = unboundedContent.slice(0, contentLimit);
    const result = { path, content: boundedContent, lineStart: startLine, lineEnd: endLine };
    this.#references.push({ path, lineStart: startLine, lineEnd: endLine });
    return this.record("cat", { path }, result);
  }

  private sourceForPath(path: string): SourceFile | null {
    const match = path.match(/^\/sources\/([^/]+)$/);
    return match ? (this.#sourceByName.get(match[1]) ?? null) : null;
  }

  private async assertDirectory(path: string): Promise<void> {
    if (path === "/" || path === "/sources" || path === "/wiki") return;
    const page = await this.resolveWikiDirectory(path);
    if (!page || !(await this.store.canView(page)))
      throw new Error("Workspace directory not found");
  }

  private async resolveWikiDirectory(path: string): Promise<WorkspacePage | null> {
    if (path === "/wiki") return null;
    if (!path.startsWith("/wiki/")) throw new Error("Workspace path is outside /wiki");
    const segments = path.slice("/wiki/".length).split("/");
    if (
      segments.length > WIKI_WORKSPACE_LIMITS.maxPathDepth ||
      segments.some((segment) => !segment)
    ) {
      throw new Error("Invalid wiki workspace path");
    }
    let page: WorkspacePage | null = null;
    for (const segment of segments) {
      page = page
        ? await this.store.getChildPage(page.id, segment)
        : await this.store.getRootPage(segment);
      if (!page || page.status !== "published") return null;
    }
    return page;
  }

  private async pathForPage(page: WorkspacePage): Promise<string> {
    const segments = [page.slug];
    let parentId = page.parentId;
    for (let depth = 0; parentId && depth < WIKI_WORKSPACE_LIMITS.maxPathDepth; depth++) {
      const parent = await this.store.getPageById(parentId);
      if (!parent || parent.status !== "published") throw new Error("Invalid wiki page hierarchy");
      segments.unshift(parent.slug);
      parentId = parent.parentId;
    }
    if (parentId) throw new Error("Wiki page hierarchy exceeds maximum depth");
    return `/wiki/${segments.join("/")}`;
  }

  private record<T>(
    tool: WorkspaceTrace["tool"],
    details: { path?: string; query?: string },
    data: T,
  ): WorkspaceResult<T> {
    const remaining = Math.max(0, this.maxTokens - this.#consumedTokens);
    if (remaining === 0) {
      this.#tools.push({
        ...details,
        tool,
        outputTokens: 0,
        truncated: true,
        at: new Date().toISOString(),
      });
      throw new WorkspaceBudgetExceededError();
    }
    // Individual operations are bounded. The workflow still receives a trace
    // when its shared budget is exhausted, making a model failure diagnosable.
    const allowedTokens = Math.min(WIKI_WORKSPACE_LIMITS.maxToolOutputTokens, remaining);
    const fitted = fitToolOutput(data, allowedTokens * 3);
    const outputTokens = tokenEstimate(serialise(fitted.data));
    if (outputTokens > allowedTokens) {
      this.#tools.push({
        ...details,
        tool,
        outputTokens: 0,
        truncated: true,
        at: new Date().toISOString(),
      });
      throw new WorkspaceBudgetExceededError();
    }
    const truncated = fitted.truncated || outputTokens > allowedTokens;
    this.#consumedTokens += outputTokens;
    this.#tools.push({ ...details, tool, outputTokens, truncated, at: new Date().toISOString() });
    return { data: fitted.data, truncated, manifest: this.manifest() };
  }
}

type PageRow = Omit<WorkspacePage, "updatedAt"> & { updatedAt: Date };

function toPage(row: PageRow): WorkspacePage {
  return row;
}

/** Production D1 adapter. Every method selects only the columns it needs. */
export function createD1WikiWorkspaceStore(db: Db, actor: WorkspaceActor): WikiWorkspaceStore {
  const pageColumns = {
    id: schema.pages.id,
    slug: schema.pages.slug,
    titleJa: schema.pages.titleJa,
    titleEn: schema.pages.titleEn,
    summaryJa: schema.pages.summaryJa,
    summaryEn: schema.pages.summaryEn,
    parentId: schema.pages.parentId,
    status: schema.pages.status,
    pageType: schema.pages.pageType,
    pageMetadata: schema.pages.pageMetadata,
    visibility: schema.pages.visibility,
    generalRole: schema.pages.generalRole,
    chapterId: schema.pages.chapterId,
    authorId: schema.pages.authorId,
    updatedAt: schema.pages.updatedAt,
  };

  async function getPage(where: SQL | undefined): Promise<WorkspacePage | null> {
    const page = await db.select(pageColumns).from(schema.pages).where(where).get();
    return page ? toPage(page) : null;
  }

  async function bodyFor(id: string): Promise<WorkspacePageBody | null> {
    const page = await db
      .select({
        ...pageColumns,
        contentJa: schema.pages.contentJa,
        contentEn: schema.pages.contentEn,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, id))
      .get();
    if (!page) return null;
    const tagRows = await db
      .select({ tag: schema.pageTags.tagSlug })
      .from(schema.pageTags)
      .where(eq(schema.pageTags.pageId, id))
      .all();
    return { ...page, tags: tagRows.map((tag) => tag.tag) };
  }

  return {
    getRootPage: (slug) => getPage(and(eq(schema.pages.slug, slug), isNull(schema.pages.parentId))),
    getChildPage: (parentId, slug) =>
      getPage(and(eq(schema.pages.slug, slug), eq(schema.pages.parentId, parentId))),
    getPageById: (id) => getPage(eq(schema.pages.id, id)),
    getPageBody: bodyFor,
    listChildren: async (parentId, { limit, offset }) => {
      const rows = await db
        .select(pageColumns)
        .from(schema.pages)
        .where(
          and(
            parentId ? eq(schema.pages.parentId, parentId) : isNull(schema.pages.parentId),
            eq(schema.pages.status, "published"),
          ),
        )
        .orderBy(asc(schema.pages.sortOrder), asc(schema.pages.slug), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map(toPage);
    },
    findPublicPages: async (query, { limit, offset }) => {
      const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await db
        .select(pageColumns)
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.status, "published"),
            eq(schema.pages.visibility, "public"),
            or(
              like(schema.pages.slug, pattern),
              like(schema.pages.titleJa, pattern),
              like(schema.pages.titleEn, pattern),
            ),
          ),
        )
        .orderBy(asc(schema.pages.updatedAt), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all();
      return rows.map(toPage);
    },
    grepPublicPages: async (query, { limit, offset }) => {
      const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await db
        .select({
          ...pageColumns,
          contentJa: schema.pages.contentJa,
          contentEn: schema.pages.contentEn,
        })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.status, "published"),
            eq(schema.pages.visibility, "public"),
            or(like(schema.pages.contentJa, pattern), like(schema.pages.contentEn, pattern)),
          ),
        )
        .orderBy(asc(schema.pages.updatedAt), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all();
      const pageIds = rows.map((row) => row.id);
      const tagRows = pageIds.length
        ? await db
            .select({ pageId: schema.pageTags.pageId, tag: schema.pageTags.tagSlug })
            .from(schema.pageTags)
            .where(inArray(schema.pageTags.pageId, pageIds))
            .all()
        : [];
      const tagsByPage = new Map<string, string[]>();
      for (const tag of tagRows) {
        if (!pageIds.includes(tag.pageId)) continue;
        tagsByPage.set(tag.pageId, [...(tagsByPage.get(tag.pageId) ?? []), tag.tag]);
      }
      return rows.map((row) => ({ ...row, tags: tagsByPage.get(row.id) ?? [] }));
    },
    canView: (page) =>
      getEffectivePagePermissions(
        db,
        page,
        { id: actor.userId, email: actor.email, isAdmin: actor.isAdmin },
        actor.chapterIds,
      ).then((permissions) => permissions.canView),
  };
}

export function createWikiWorkspace(options: {
  db: Db;
  actor: WorkspaceActor;
  sources?: readonly SourceFile[];
  maxTokens?: number;
}): WikiWorkspace {
  return new WikiWorkspace(
    createD1WikiWorkspaceStore(options.db, options.actor),
    options.sources,
    options.maxTokens,
  );
}
