import { tiptapToMarkdown } from "../../../../../app/lib/tiptap-convert";
import type {
  AdapterResult,
  ListOptions,
  ListResult,
  ReadOptions,
  ReadResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
  WorkspaceAdapter,
  WorkspaceEntry,
} from "./contracts";
import {
  boundedLimit,
  cleanQuery,
  decodeOffsetCursor,
  encodeOffsetCursor,
  normaliseRelativeWorkspacePath,
} from "./paths";

export type WorkspaceActor = {
  userId: string;
  email?: string | null;
  isAdmin: boolean;
  chapterIds: readonly string[];
};

export type WikiWorkspacePage = {
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

export type WikiWorkspacePageBody = WikiWorkspacePage & {
  contentJa: string;
  contentEn: string;
  tags: string[];
};

type StoreListOptions = { limit: number; offset: number };

/**
 * Pure Tool-layer port. The D1 implementation owns query construction and
 * evaluates permissions, while this adapter owns virtual path semantics.
 */
export interface WikiWorkspaceStore {
  getRootPage(slug: string): Promise<WikiWorkspacePage | null>;
  getChildPage(parentId: string, slug: string): Promise<WikiWorkspacePage | null>;
  getPageById(id: string): Promise<WikiWorkspacePage | null>;
  getPageBody(id: string): Promise<WikiWorkspacePageBody | null>;
  listChildren(parentId: string | null, options: StoreListOptions): Promise<WikiWorkspacePage[]>;
  findPages(query: string, options: StoreListOptions): Promise<WikiWorkspacePage[]>;
  searchPageBodies(query: string, options: StoreListOptions): Promise<WikiWorkspacePageBody[]>;
  canView(page: WikiWorkspacePage): Promise<boolean>;
}

function titleOf(page: WikiWorkspacePage): string {
  return page.titleJa || page.titleEn || page.slug;
}

function summaryOf(page: WikiWorkspacePage): string {
  return page.summaryJa || page.summaryEn;
}

function contentOf(page: WikiWorkspacePageBody): string {
  return tiptapToMarkdown(page.contentJa || page.contentEn || "");
}

function pageContent(page: WikiWorkspacePageBody): string {
  const parts = [`# ${titleOf(page)}`];
  const summary = summaryOf(page);
  if (summary) parts.push(summary);
  const content = contentOf(page);
  if (content) parts.push(content);
  return parts.join("\n\n");
}

function sliceContent(
  path: string,
  content: string,
  options: ReadOptions | undefined,
): AdapterResult<ReadResult> {
  const maxChars = boundedLimit(options?.maxChars, 24_000, 12_000);
  const offset = decodeOffsetCursor(options?.cursor);
  if (offset > content.length) throw new Error("Workspace cursor is outside resource");
  const end = Math.min(content.length, offset + maxChars);
  return {
    data: {
      path,
      content: content.slice(offset, end),
      nextCursor: end < content.length ? encodeOffsetCursor(end) : null,
    },
    truncated: end < content.length,
  };
}

function boundedVisiblePages(
  pages: readonly WikiWorkspacePage[],
  limit: number,
  canView: (page: WikiWorkspacePage) => Promise<boolean>,
): Promise<WikiWorkspacePage[]> {
  return Promise.all(pages.map(async (page) => ((await canView(page)) ? page : null))).then(
    (values) => values.filter((page): page is WikiWorkspacePage => page !== null).slice(0, limit),
  );
}

/**
 * Maps D1's parentId hierarchy lazily. A Wiki page node is readable at its
 * own path and may also have descendants; there are no artificial `index.*`
 * files or directory-only proxy nodes.
 */
export class WikiWorkspaceAdapter implements WorkspaceAdapter {
  constructor(private readonly store: WikiWorkspaceStore) {}

  async ls(relativePath: string, options: ListOptions = {}): Promise<AdapterResult<ListResult>> {
    const path = normaliseRelativeWorkspacePath(relativePath);
    const page = path ? await this.resolvePage(path) : null;
    if (path && (!page || !(await this.store.canView(page)))) {
      throw new Error("Workspace path not found");
    }
    const limit = boundedLimit(options.limit, 50, 25);
    const offset = decodeOffsetCursor(options.cursor);
    const candidates = await this.store.listChildren(page?.id ?? null, {
      // Read one extra record so the cursor is correct without reading bodies.
      limit: limit + 1,
      offset,
    });
    const visible = await boundedVisiblePages(candidates.slice(0, limit), limit, (candidate) =>
      this.store.canView(candidate),
    );
    const entries = visible.map(
      (child) =>
        ({
          name: child.slug,
          path: path ? `${path}/${child.slug}` : child.slug,
          readable: true,
          hasChildren: "unknown",
          title: titleOf(child),
        }) satisfies WorkspaceEntry,
    );
    const hasMore = candidates.length > limit;
    return {
      data: {
        path,
        entries,
        nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
      },
      truncated: hasMore,
    };
  }

  async cat(relativePath: string, options?: ReadOptions): Promise<AdapterResult<ReadResult>> {
    const path = normaliseRelativeWorkspacePath(relativePath);
    if (!path) throw new Error("Workspace resource not found");
    const page = await this.resolvePage(path);
    if (!page || !(await this.store.canView(page))) throw new Error("Workspace resource not found");
    const body = await this.store.getPageBody(page.id);
    if (!body) throw new Error("Workspace resource not found");
    return sliceContent(path, pageContent(body), options);
  }

  async search(
    relativePath: string,
    rawQuery: string,
    options: SearchOptions = {},
  ): Promise<AdapterResult<SearchResult>> {
    const scope = normaliseRelativeWorkspacePath(relativePath);
    if (scope) {
      const scopePage = await this.resolvePage(scope);
      if (!scopePage || !(await this.store.canView(scopePage))) {
        throw new Error("Workspace path not found");
      }
    }
    const query = cleanQuery(rawQuery);
    const limit = boundedLimit(options.limit, 20, 12);
    const offset = decodeOffsetCursor(options.cursor);
    const [namedCandidates, bodyCandidates] = await Promise.all([
      this.store.findPages(query, { limit: limit + 1, offset }),
      this.store.searchPageBodies(query, { limit: limit + 1, offset }),
    ]);
    const candidates = new Map<string, WikiWorkspacePage>();
    for (const page of [...namedCandidates, ...bodyCandidates]) candidates.set(page.id, page);
    const visible = await boundedVisiblePages([...candidates.values()], limit, (page) =>
      this.store.canView(page),
    );
    const matches: SearchMatch[] = [];
    for (const page of visible) {
      const path = await this.pathForPage(page);
      if (scope && path !== scope && !path.startsWith(`${scope}/`)) continue;
      matches.push({
        path,
        title: titleOf(page),
        ...(summaryOf(page) ? { snippet: summaryOf(page).slice(0, 500) } : {}),
      });
    }
    const hasMore = namedCandidates.length > limit || bodyCandidates.length > limit;
    return {
      data: { matches, nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null },
      truncated: hasMore,
    };
  }

  private async resolvePage(path: string): Promise<WikiWorkspacePage | null> {
    const segments = path.split("/");
    let page: WikiWorkspacePage | null = null;
    for (const segment of segments) {
      page = page
        ? await this.store.getChildPage(page.id, segment)
        : await this.store.getRootPage(segment);
      if (!page || page.status !== "published") return null;
    }
    return page;
  }

  private async pathForPage(page: WikiWorkspacePage): Promise<string> {
    const segments = [page.slug];
    let parentId = page.parentId;
    for (let depth = 0; parentId && depth < 16; depth += 1) {
      const parent = await this.store.getPageById(parentId);
      if (!parent || parent.status !== "published") throw new Error("Invalid Wiki page hierarchy");
      segments.unshift(parent.slug);
      parentId = parent.parentId;
    }
    if (parentId) throw new Error("Wiki page hierarchy exceeds maximum depth");
    return segments.join("/");
  }
}
