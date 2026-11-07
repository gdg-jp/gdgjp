import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useLoaderData, useNavigate, useNavigation, useParams } from "react-router";
import { ListSkeleton } from "~/components/Skeleton";
import type { AiRagResult } from "~/features/knowledge/wiki-search.server";
import TagChip from "~/features/pages/components/TagChip";
import type { loader } from "../search";
import { IncludeAgentPagesButton, ResultLocation, timeAgo } from "./search-parts";

export function SearchView() {
  const {
    q,
    tag,
    mode,
    allTags: everyTag,
    results,
    ragResult,
    hideAgentPages,
  } = useLoaderData<typeof loader>();
  // A tag nobody used filters to nothing: offer only the ones that exist on a page.
  const allTags = everyTag.filter((tg) => tg.pageCount > 0 || tg.slug === tag);
  const { t, i18n } = useTranslation();
  const isJa = i18n.language === "ja";
  const navigate = useNavigate();
  const navigation = useNavigation();
  // `/s/:space/search` stays inside that space when the mode or tag changes.
  const { space: spaceParam } = useParams();
  const searchBase = spaceParam ? `/s/${encodeURIComponent(spaceParam)}/search` : "/search";

  const isNavigating = navigation.state === "loading";

  const activeTagLabel = allTags.find((tg) => tg.slug === tag);
  const activeTagName = activeTagLabel
    ? isJa
      ? activeTagLabel.labelJa
      : activeTagLabel.labelEn
    : tag;

  function go(params: URLSearchParams) {
    navigate(`${searchBase}${params.size > 0 ? `?${params}` : ""}`);
  }

  function handleTagSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (value) params.set("tag", value);
    if (mode === "ai") params.set("mode", "ai");
    go(params);
  }

  function handleModeSwitch(newMode: "keyword" | "ai") {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    if (newMode === "ai") params.set("mode", "ai");
    go(params);
  }

  const clearTagHref = q ? `${searchBase}?q=${encodeURIComponent(q)}` : searchBase;

  return (
    <div className="max-w-3xl px-4 py-6 md:px-8 md:py-8">
      <h1 className="mb-4 text-lg font-semibold text-foreground">{t("search.title")}</h1>

      {/* Mode toggle tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-neutral p-1">
        <button
          type="button"
          onClick={() => handleModeSwitch("keyword")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode !== "ai"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t("search.mode_keyword")}
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch("ai")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "ai"
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t("search.mode_ai")}
        </button>
      </div>

      {/* Tag filter dropdown */}
      {mode !== "ai" && allTags.length > 0 && (
        <div className="mb-6 flex items-center gap-2">
          <label htmlFor="tag-filter" className="text-sm font-medium text-muted whitespace-nowrap">
            {t("search.filter_by_tag")}
          </label>
          <select
            id="tag-filter"
            value={tag}
            onChange={handleTagSelect}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-muted focus:border-border-ring focus:outline-none focus:ring-1 focus:ring-ring"
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
              to={clearTagHref}
              className="text-xs text-muted/70 hover:text-muted"
              aria-label={t("search.clear_tag")}
            >
              ✕
            </Link>
          )}
        </div>
      )}

      {/* AI search results */}
      {mode === "ai" ? (
        !q ? (
          <p className="text-sm text-muted">{t("search.empty_query")}</p>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center gap-2 py-8 text-sm text-muted">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-ring border-t-transparent motion-reduce:animate-none" />
                {t("search.ai_searching")}
              </div>
            }
          >
            <Await
              resolve={ragResult ?? Promise.resolve(null)}
              errorElement={
                <AiSearchResults
                  q={q}
                  ragResult={null}
                  isJa={isJa}
                  hideAgentPages={hideAgentPages}
                  t={t}
                />
              }
            >
              {(resolved) => (
                <AiSearchResults
                  q={q}
                  ragResult={resolved}
                  isJa={isJa}
                  hideAgentPages={hideAgentPages}
                  t={t}
                />
              )}
            </Await>
          </Suspense>
        )
      ) : /* Keyword search results */
      !q && !tag ? (
        <p className="text-sm text-muted">{t("search.empty_query")}</p>
      ) : isNavigating ? (
        <ListSkeleton rows={5} />
      ) : results.length === 0 ? (
        <div>
          <p className="text-sm text-muted">
            {tag && !q
              ? t("search.no_results_tag", { tag: activeTagName })
              : t("search.no_results", { query: q })}
            {hideAgentPages ? ` ${t("search.agent_pages_hidden")}` : null}
          </p>
          {q && (
            <button
              type="button"
              onClick={() => handleModeSwitch("ai")}
              className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-link transition-colors hover:bg-neutral"
            >
              {t("search.try_ai")}
            </button>
          )}
          {hideAgentPages && <IncludeAgentPagesButton />}
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-muted">
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
                    to={page.wikiPath}
                    className="block rounded-lg border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-border-ring/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-foreground hover:text-link">{title}</span>
                    <ResultLocation
                      ancestors={page.ancestors}
                      spaceName={page.spaceName}
                      isJa={isJa}
                    />

                    {summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{summary}</p>}
                    {page.matchSnippet && !(summary ?? "").includes(page.matchSnippet) && (
                      <p
                        className="mt-1 line-clamp-2 text-xs text-muted/80"
                        data-testid="search-snippet"
                      >
                        {page.matchSnippet}
                      </p>
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
                        <time className="ml-auto text-xs text-muted/70">
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

function AiSearchResults({
  q,
  ragResult,
  isJa,
  hideAgentPages,
  t,
}: {
  q: string;
  ragResult: AiRagResult | null;
  isJa: boolean;
  hideAgentPages: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!q) {
    return <p className="text-sm text-muted">{t("search.empty_query")}</p>;
  }

  if (!ragResult) {
    return <p className="text-sm text-muted">{t("search.ai_error")}</p>;
  }

  if (!ragResult.ragAvailable) {
    return <p className="text-sm text-muted">{t("search.ai_unavailable")}</p>;
  }

  if (!ragResult.answer && ragResult.sources.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted">
          {t("search.ai_no_results")}
          {hideAgentPages ? ` ${t("search.agent_pages_hidden")}` : null}
        </p>
        {hideAgentPages && <IncludeAgentPagesButton />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI Answer card */}
      {ragResult.answer && (
        <div className="rounded-lg border border-link bg-selected/50 p-4  ">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-link ">
            <span className="text-base">&#10022;</span>
            {t("search.ai_answer")}
          </div>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">
            {ragResult.answer}
          </div>
        </div>
      )}

      {/* Source pages */}
      {ragResult.sources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted">
            {t("search.related_pages", { count: ragResult.sources.length })}
          </h2>
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
                    to={source.wikiPath}
                    className="block rounded-lg border border-border bg-surface p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-border-ring/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-foreground hover:text-link">{title}</span>
                    <ResultLocation
                      ancestors={source.ancestors}
                      spaceName={source.spaceName}
                      isJa={isJa}
                    />

                    {summary && <p className="mt-1 line-clamp-2 text-sm text-muted">{summary}</p>}
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
