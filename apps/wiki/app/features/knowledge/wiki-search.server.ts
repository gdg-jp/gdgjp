import { type SQL, type SQLWrapper, and, desc, eq, inArray, sql } from "drizzle-orm";
import * as schema from "~/db/schema";
import { getAccessIdentity } from "~/features/auth/utils.server";
import { MAX_SEARCH_SPACES } from "~/features/knowledge/search.server";
import { searchForReader } from "~/features/knowledge/viewer-search.server";
import { agentPagesFilter, pagesInSpaces } from "~/features/pages/page-space.server";
import { buildVisibilityFilter } from "~/features/pages/visibility.server";
import {
  type WikiAncestor,
  getWikiAncestry,
  getWikiPageUrls,
} from "~/features/pages/wiki-page-path.server";
import { listAccessibleSpaces, requireSpace } from "~/features/spaces/access.server";
import { loadViewerContext } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";
import { matchSnippet } from "./keyword-snippet";

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
    /** Parent chain (root first), for the breadcrumb under the title. */
    ancestors: Breadcrumb[];
    spaceName: string;
  }>;
};

export type Breadcrumb = { titleJa: string; titleEn: string };

/** Parents only (root first), never the page itself. */
export function parentCrumbs(chain: WikiAncestor[] | undefined): Breadcrumb[] {
  return (chain ?? []).slice(0, -1).map(({ titleJa, titleEn }) => ({ titleJa, titleEn }));
}

/** Names of the spaces a listing may contain, so results from other spaces say where they are. */
async function spaceNamesById(db: ReturnType<typeof getDb>, viewer: { access: SpaceAccessLike }) {
  const rows = await listAccessibleSpaces(db, viewer.access as never);
  return new Map(rows.map((space) => [space.id, { slug: space.slug, name: space.name }]));
}
type SpaceAccessLike = Parameters<typeof listAccessibleSpaces>[1];

const SEARCH_LIMIT = 50;
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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
  const scopedId = spaceSlug
    ? (await requireSpace(request, env, spaceSlug, "viewer", identity)).space.id
    : null;
  // The empty state says when the reader's own setting hid agent pages from the results.
  const hideAgentPages = viewer.hideAgentPages;
  // `/search` lists pages from every reachable space: each result then names its space.
  const scoped = Boolean(spaceSlug);
  const spaceNames = scoped ? null : await spaceNamesById(db, viewer);
  const spaceNameOf = (spaceId: string) => (scoped ? "" : (spaceNames?.get(spaceId)?.name ?? ""));
  const visFilter = and(
    pagesInSpaces(scopedId ? [scopedId] : viewer.visibleSpaceIds),
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
    const spaceIds = (scopedId ? [scopedId] : viewer.visibleSpaceIds).slice(0, MAX_SEARCH_SPACES);
    const ragResult: Promise<AiRagResult> = searchForReader(env, db, identity, {
      spaceIds,
      query: q,
      hideAgentPages: viewer.hideAgentPages,
    })
      .then(async ({ pages }): Promise<AiRagResult> => {
        const chains = await getWikiAncestry(
          env,
          pages.map((page) => page.pageId),
        );
        return {
          answer: "",
          ragAvailable: true,
          sources: pages.map((page) => ({
            ...page,
            ancestors: parentCrumbs(chains.get(page.pageId)),
            spaceName: spaceNameOf(page.spaceId),
          })),
        };
      })
      .catch((err): AiRagResult => {
        console.error("search: knowledge search failed", err);
        return { answer: "", sources: [], ragAvailable: false };
      });

    return {
      hideAgentPages,
      scoped,
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
        spaceId: schema.pages.spaceId,
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

    const [urls, chains] = await Promise.all([
      getWikiPageUrls(
        env,
        pages.map((p) => p.id),
      ),
      getWikiAncestry(
        env,
        pages.map((p) => p.id),
      ),
    ]);
    return {
      hideAgentPages,
      scoped,
      q,
      tag,
      mode,
      allTags,
      results: pages.map((p) => ({
        ...p,
        tags: tagsByPage.get(p.id) ?? [],
        wikiPath: urls.get(p.id) ?? "",
        ancestors: parentCrumbs(chains.get(p.id)),
        spaceName: spaceNameOf(p.spaceId),
        matchSnippet: "",
      })),
      ragResult: null,
    };
  }

  // Case B: no query at all
  if (!q && !tag)
    return { hideAgentPages, scoped, q: "", tag: "", mode, allTags, results: [], ragResult: null };

  // Case B/C: text query (with or without tag). Every word must match somewhere in the
  // page ("DevFest Kansai 2026 会場費" is four terms, not one phrase).
  const sanitized = sanitizeFtsQuery(q);
  const terms = sanitized.split(/\s+/).filter(Boolean);
  if (!sanitized || terms.length === 0)
    return { hideAgentPages, scoped, q, tag, mode, allTags, results: [], ragResult: null };
  const termPatterns = terms.map((term) => `%${escapeLike(term)}%`);
  const allTermsIn = (column: SQLWrapper) =>
    sql.join(
      termPatterns.map((p) => sql`${column} LIKE ${p} ESCAPE '\\'`),
      sql` AND `,
    );
  const anyFieldHasAllTerms = sql`(
    (${allTermsIn(schema.pages.titleJa)}) OR (${allTermsIn(schema.pages.titleEn)})
    OR (${allTermsIn(schema.pages.summaryJa)}) OR (${allTermsIn(schema.pages.summaryEn)})
    OR (${allTermsIn(schema.pages.contentJa)}) OR (${allTermsIn(schema.pages.contentEn)}))`;
  const titleHasAllTerms = sql`CASE WHEN (${allTermsIn(schema.pages.titleJa)})
    OR (${allTermsIn(schema.pages.titleEn)}) THEN 0 ELSE 1 END`;
  const summaryHasAllTerms = sql`CASE WHEN (${allTermsIn(schema.pages.summaryJa)})
    OR (${allTermsIn(schema.pages.summaryEn)}) THEN 0 ELSE 1 END`;

  // Filters go into the same query as the match, before the limit: cutting the FTS hits to
  // 50 first let pages in other spaces (or hidden ones) crowd out the reader's own.
  const tagFilter = tag
    ? sql`${schema.pages.id} IN (SELECT page_id FROM page_tags WHERE tag_slug = ${tag})`
    : undefined;
  const columns = {
    id: schema.pages.id,
    slug: schema.pages.slug,
    titleJa: schema.pages.titleJa,
    titleEn: schema.pages.titleEn,
    summaryJa: schema.pages.summaryJa,
    summaryEn: schema.pages.summaryEn,
    updatedAt: schema.pages.updatedAt,
    spaceId: schema.pages.spaceId,
    contentJa: schema.pages.contentJa,
    contentEn: schema.pages.contentEn,
  };

  // Title matches first, then summary matches, then pages that only mention the terms in
  // their body; newest first within a tier. (The trigram FTS index never covered bodies and
  // cannot express "all words anywhere", so plain LIKE does the work over the reader's pages.)
  const rows = await db
    .select(columns)
    .from(schema.pages)
    .where(and(anyFieldHasAllTerms, eq(schema.pages.status, "published"), visFilter, tagFilter))
    .orderBy(titleHasAllTerms, summaryHasAllTerms, desc(schema.pages.updatedAt))
    .limit(SEARCH_LIMIT)
    .all();
  const orderedPages = rows.map(({ contentJa, contentEn, ...page }) => ({
    ...page,
    // The place the first term appears, so the card shows why it matched.
    matchSnippet: matchSnippet([page.summaryJa, page.summaryEn, contentJa, contentEn], terms),
  }));

  const pageTags = await fetchTagsForPages(orderedPages.map((p) => p.id));
  const tagsByPage = new Map<string, PageTag[]>();
  for (const pt of pageTags) {
    const arr = tagsByPage.get(pt.pageId) ?? [];
    arr.push(pt);
    tagsByPage.set(pt.pageId, arr);
  }

  const [urls, chains] = await Promise.all([
    getWikiPageUrls(
      env,
      orderedPages.map((p) => p.id),
    ),
    getWikiAncestry(
      env,
      orderedPages.map((p) => p.id),
    ),
  ]);
  return {
    hideAgentPages,
    scoped,
    q,
    tag,
    mode,
    allTags,
    results: orderedPages.map((p) => ({
      ...p,
      tags: tagsByPage.get(p.id) ?? [],
      wikiPath: urls.get(p.id) ?? "",
      ancestors: parentCrumbs(chains.get(p.id)),
      spaceName: spaceNameOf(p.spaceId),
    })),
    ragResult: null,
  };
}
