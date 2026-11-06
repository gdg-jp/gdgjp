import { type SQL, and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import { getAccessIdentity } from "~/features/auth/utils.server";
import { MAX_SEARCH_SPACES } from "~/features/knowledge/search.server";
import { searchForReader } from "~/features/knowledge/viewer-search.server";
import { agentPagesFilter, pagesInSpaces } from "~/features/pages/page-space.server";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import { getWikiPageUrls } from "~/features/pages/wiki-page-path.server";
import { requireSpace } from "~/features/spaces/access.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";

/** "AI" search mode result: AI Search page hits (no generated answer; the Worker calls no LLM). */
export type AiRagResult = {
  answer: string;
  ragAvailable: boolean;
  sources: Array<{
    pageId: string;
    slug: string;
    titleJa: string;
    titleEn: string;
    summaryJa: string;
    summaryEn: string;
    relevanceScore: number;
    matchedChunks: Array<{ text: string; sectionHeading: string | null }>;
    wikiPath: string;
  }>;
};

/** Strip FTS5 special operators to prevent query injection */
function sanitizeFtsQuery(raw: string): string {
  return raw.replace(/[*"():^{}~<>|]/g, "").trim();
}

/** Data assembly behind the `/search` loader (keyword FTS + streamed AI RAG). */
export async function loadWikiSearch(request: Request, env: Env, spaceSlug?: string) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const mode = url.searchParams.get("mode") === "ai" ? "ai" : "keyword";

  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const viewer = await loadViewerContext(request, env, identity);
  // `/s/:space/search` searches one space; `/search` every reachable space.
  const scoped = spaceSlug
    ? (await requireSpace(request, env, spaceSlug, "viewer", identity)).space.id
    : null;
  const visFilter = and(
    pagesInSpaces(scoped ? [scoped] : viewer.visibleSpaceIds),
    buildVisibilityFilter(identity.user, identity.chapters),
    agentPagesFilter(viewer.hideAgentPages),
  ) as SQL;

  const allTagsPromise = db.select().from(schema.tags).orderBy(desc(schema.tags.pageCount)).all();

  type PageTag = {
    pageId: string;
    tagSlug: string;
    labelJa: string;
    labelEn: string;
    color: string;
  };

  async function fetchTagsForPages(pageIds: string[]): Promise<PageTag[]> {
    if (pageIds.length === 0) return [];
    return db
      .select({
        pageId: schema.pageTags.pageId,
        tagSlug: schema.pageTags.tagSlug,
        labelJa: schema.tags.labelJa,
        labelEn: schema.tags.labelEn,
        color: schema.tags.color,
      })
      .from(schema.pageTags)
      .innerJoin(schema.tags, eq(schema.pageTags.tagSlug, schema.tags.slug))
      .where(inArray(schema.pageTags.pageId, pageIds))
      .all();
  }

  // "AI" mode — Cloudflare AI Search over the spaces the reader can reach (Stage 03). No
  // answer is generated here: the Worker never calls an LLM; agents answer in Discord.
  if (mode === "ai" && q) {
    const spaceIds = (scoped ? [scoped] : viewer.visibleSpaceIds).slice(0, MAX_SEARCH_SPACES);
    const ragResult: Promise<AiRagResult> = searchForReader(env, db, identity, {
      spaceIds,
      query: q,
      hideAgentPages: viewer.hideAgentPages,
    })
      .then(({ pages }): AiRagResult => ({ answer: "", ragAvailable: true, sources: pages }))
      .catch((err): AiRagResult => {
        console.error("search: knowledge search failed", err);
        return { answer: "", sources: [], ragAvailable: false };
      });

    return {
      q,
      tag,
      mode,
      allTags: await allTagsPromise,
      results: [],
      ragResult,
    };
  }

  const allTags = await allTagsPromise;

  // Case A: tag only (no text query)
  if (!q && tag) {
    const pages = await db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        titleEn: schema.pages.titleEn,
        summaryJa: schema.pages.summaryJa,
        summaryEn: schema.pages.summaryEn,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .innerJoin(schema.pageTags, eq(schema.pageTags.pageId, schema.pages.id))
      .where(and(eq(schema.pageTags.tagSlug, tag), eq(schema.pages.status, "published"), visFilter))
      .orderBy(desc(schema.pages.updatedAt))
      .limit(50)
      .all();

    const pageTags = await fetchTagsForPages(pages.map((p) => p.id));
    const tagsByPage = new Map<string, PageTag[]>();
    for (const pt of pageTags) {
      const arr = tagsByPage.get(pt.pageId) ?? [];
      arr.push(pt);
      tagsByPage.set(pt.pageId, arr);
    }

    const urls = await getWikiPageUrls(
      env,
      pages.map((p) => p.id),
    );
    return {
      q,
      tag,
      mode,
      allTags,
      results: pages.map((p) => ({
        ...p,
        tags: tagsByPage.get(p.id) ?? [],
        wikiPath: urls.get(p.id) ?? "",
      })),
      ragResult: null,
    };
  }

  // Case B: no query at all
  if (!q && !tag) return { q: "", tag: "", mode, allTags, results: [], ragResult: null };

  // Case B/C: text query (with or without tag)
  const sanitized = sanitizeFtsQuery(q);
  if (!sanitized) return { q, tag, mode, allTags, results: [], ragResult: null };

  const ftsQuery = `"${sanitized}"`;

  const matched = await db.all<{
    page_id: string;
    rank: number;
  }>(
    sql`SELECT page_id, rank
        FROM pages_fts_trigram
        WHERE pages_fts_trigram MATCH ${ftsQuery}
        ORDER BY rank
        LIMIT 50`,
  );

  if (matched.length === 0) return { q, tag, mode, allTags, results: [], ragResult: null };

  let pageIds = matched.map((r) => r.page_id);

  // Case C: intersect with tag filter
  if (tag) {
    const taggedRows = await db
      .select({ pageId: schema.pageTags.pageId })
      .from(schema.pageTags)
      .where(eq(schema.pageTags.tagSlug, tag))
      .all();
    const taggedIds = new Set(taggedRows.map((r) => r.pageId));
    pageIds = pageIds.filter((id) => taggedIds.has(id));
  }

  if (pageIds.length === 0) return { q, tag, mode, allTags, results: [], ragResult: null };

  // Fetch full page data for matched IDs, filtered to published + visibility
  const pages = await db
    .select({
      id: schema.pages.id,
      slug: schema.pages.slug,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      summaryJa: schema.pages.summaryJa,
      summaryEn: schema.pages.summaryEn,
      updatedAt: schema.pages.updatedAt,
    })
    .from(schema.pages)
    .where(and(inArray(schema.pages.id, pageIds), eq(schema.pages.status, "published"), visFilter))
    .all();

  // Preserve FTS rank order
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const orderedPages = pageIds.map((id) => pageById.get(id)).filter(Boolean) as typeof pages;

  const pageTags = await fetchTagsForPages(orderedPages.map((p) => p.id));
  const tagsByPage = new Map<string, PageTag[]>();
  for (const pt of pageTags) {
    const arr = tagsByPage.get(pt.pageId) ?? [];
    arr.push(pt);
    tagsByPage.set(pt.pageId, arr);
  }

  const urls = await getWikiPageUrls(
    env,
    orderedPages.map((p) => p.id),
  );
  return {
    q,
    tag,
    mode,
    allTags,
    results: orderedPages.map((p) => ({
      ...p,
      tags: tagsByPage.get(p.id) ?? [],
      wikiPath: urls.get(p.id) ?? "",
    })),
    ragResult: null,
  };
}
