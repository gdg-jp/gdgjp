import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData, useNavigate, useNavigation } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import TagChip from "~/components/TagChip";
import * as schema from "~/db/schema";
import { type RagSearchResult, performRagSearch } from "~/features/ai-search/rag-search.server";
import { getAccessIdentity } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { buildVisibilityFilter } from "~/lib/page-visibility.server";
import { createAccessContext } from "../../shared/ingestion/domain";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.q ? `"${data.q}" — Search — GDG Japan Wiki` : "Search — GDG Japan Wiki" },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Strip FTS5 special operators to prevent query injection */
function sanitizeFtsQuery(raw: string): string {
  return raw.replace(/[*"():^{}~<>|]/g, "").trim();
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tag = url.searchParams.get("tag")?.trim() ?? "";
  const mode = url.searchParams.get("mode") === "ai" ? "ai" : "keyword";

  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const db = getDb(env);

  const visFilter = buildVisibilityFilter(identity.user, identity.chapterIds);

  const allTags = await db.select().from(schema.tags).orderBy(desc(schema.tags.pageCount)).all();

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

  // AI search mode
  if (mode === "ai" && q) {
    let ragResult: RagSearchResult | null = null;
    try {
      ragResult = await performRagSearch(
        env,
        db,
        q,
        createAccessContext({
          userId: identity.user?.id ?? "anonymous",
          email: identity.user?.email,
          isAdmin: identity.user?.isAdmin,
          chapterIds: identity.chapterIds,
          claimsAvailable: identity.claimsAvailable,
          source: "web",
        }),
      );
    } catch (err) {
      console.error("search: RAG search failed", err);
      ragResult = { answer: "", sources: [], ragAvailable: false };
    }
    return { q, tag, mode, allTags, results: [], ragResult };
  }

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

    return {
      q,
      tag,
      mode,
      allTags,
      results: pages.map((p) => ({ ...p, tags: tagsByPage.get(p.id) ?? [] })),
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

  return {
    q,
    tag,
    mode,
    allTags,
    results: orderedPages.map((p) => ({ ...p, tags: tagsByPage.get(p.id) ?? [] })),
    ragResult: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: Date, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("time.just_now");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { count: days });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SearchPage() {
  const { q, tag, mode, allTags, results, ragResult } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  const isJa = i18n.language === "ja";
  const navigate = useNavigate();
  const navigation = useNavigation();

  const isNavigating = navigation.state === "loading";

  const activeTagLabel = allTags.find((tg) => tg.slug === tag);
  const activeTagName = activeTagLabel
    ? isJa
      ? activeTagLabel.labelJa
      : activeTagLabel.labelEn
    : tag;

  function handleTagSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (value) params.set("tag", value);
    if (mode === "ai") params.set("mode", "ai");
    navigate(`/search${params.size > 0 ? `?${params}` : ""}`);
  }

  function handleModeSwitch(newMode: "keyword" | "ai") {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    if (newMode === "ai") params.set("mode", "ai");
    navigate(`/search${params.size > 0 ? `?${params}` : ""}`);
  }

  return (
    <div className="max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-4 text-lg font-semibold text-gray-900">{t("search.title")}</h1>

      {/* Mode toggle tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-200 p-1">
        <button
          type="button"
          onClick={() => handleModeSwitch("keyword")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode !== "ai" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("search.mode_keyword")}
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch("ai")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "ai" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {t("search.mode_ai")}
        </button>
      </div>

      {/* Tag filter dropdown */}
      {mode !== "ai" && (
        <div className="mb-6 flex items-center gap-2">
          <label
            htmlFor="tag-filter"
            className="text-sm font-medium text-gray-600 whitespace-nowrap"
          >
            {t("search.filter_by_tag")}
          </label>
          <select
            id="tag-filter"
            value={tag}
            onChange={handleTagSelect}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">{t("search.all_tags")}</option>
            {allTags.map((tg) => (
              <option key={tg.slug} value={tg.slug}>
                {isJa ? tg.labelJa : tg.labelEn}
              </option>
            ))}
          </select>

          {tag && (
            <Link
              to={q ? `/search?q=${encodeURIComponent(q)}` : "/search"}
              className="text-xs text-gray-400 hover:text-gray-600"
              aria-label={t("search.clear_tag")}
            >
              ✕
            </Link>
          )}
        </div>
      )}

      {/* AI search results */}
      {mode === "ai" ? (
        <AiSearchResults
          q={q}
          ragResult={ragResult}
          isNavigating={isNavigating}
          isJa={isJa}
          t={t}
          navigate={navigate}
        />
      ) : /* Keyword search results */
      !q && !tag ? (
        <p className="text-sm text-gray-500">{t("search.empty_query")}</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-gray-500">
          {tag && !q
            ? t("search.no_results_tag", { tag: activeTagName })
            : t("search.no_results", { query: q })}
        </p>
      ) : (
        <>
          <p className="mb-6 text-sm text-gray-500">
            {t("search.results_count", { count: results.length })}
          </p>

          <ul className="flex flex-col gap-3">
            {results.map((page) => {
              const title = isJa ? page.titleJa || page.titleEn : page.titleEn || page.titleJa;
              const summary = isJa
                ? page.summaryJa || page.summaryEn
                : page.summaryEn || page.summaryJa;

              return (
                <li key={page.id}>
                  <Link
                    to={`/wiki/${page.slug}`}
                    className="block rounded-lg border border-gray-200 bg-white p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-blue-500/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-gray-900 hover:text-blue-600">{title}</span>

                    {summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">{summary}</p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {page.tags.map((pageTag) => (
                        <TagChip
                          key={pageTag.tagSlug}
                          tagSlug={pageTag.tagSlug}
                          labelJa={pageTag.labelJa}
                          labelEn={pageTag.labelEn}
                          color={pageTag.color}
                          q={q}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ))}

                      {page.updatedAt && (
                        <time className="ml-auto text-xs text-gray-400">
                          {timeAgo(new Date(page.updatedAt), t)}
                        </time>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Search Results sub-component
// ---------------------------------------------------------------------------

function AiSearchResults({
  q,
  ragResult,
  isNavigating,
  isJa,
  t,
  navigate,
}: {
  q: string;
  ragResult: RagSearchResult | null;
  isNavigating: boolean;
  isJa: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  navigate: (to: string) => void;
}) {
  if (!q) {
    return <p className="text-sm text-gray-500">{t("search.empty_query")}</p>;
  }

  if (isNavigating) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent motion-reduce:animate-none" />
        {t("search.ai_searching")}
      </div>
    );
  }

  if (!ragResult) {
    return <p className="text-sm text-gray-500">{t("search.ai_error")}</p>;
  }

  if (!ragResult.ragAvailable) {
    return <p className="text-sm text-gray-500">{t("search.ai_unavailable")}</p>;
  }

  if (!ragResult.answer && ragResult.sources.length === 0) {
    return <p className="text-sm text-gray-500">{t("search.ai_no_results")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI Answer card */}
      {ragResult.answer && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-blue-700 dark:text-blue-300">
            <span className="text-base">&#10022;</span>
            {t("search.ai_answer")}
          </div>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
            {ragResult.answer}
          </div>
        </div>
      )}

      {/* Source pages */}
      {ragResult.sources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-gray-600">{t("search.ai_sources")}</h2>
          <ul className="flex flex-col gap-3">
            {ragResult.sources.map((source) => {
              const title = isJa
                ? source.titleJa || source.titleEn
                : source.titleEn || source.titleJa;
              const summary = isJa
                ? source.summaryJa || source.summaryEn
                : source.summaryEn || source.summaryJa;

              return (
                <li key={source.pageId}>
                  <Link
                    to={`/wiki/${source.slug}`}
                    className="block rounded-lg border border-gray-200 bg-white p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-blue-500/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-gray-900 hover:text-blue-600">{title}</span>

                    {summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-500">{summary}</p>
                    )}

                    <div className="mt-2 text-xs text-gray-400">
                      {Math.round(source.relevanceScore * 100)}% match
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
