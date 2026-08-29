import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useLoaderData, useNavigate, useNavigation } from "react-router";
import { ListSkeleton } from "~/components/Skeleton";
import type { AiRagResult } from "~/features/ai-search/wiki-search.server";
import TagChip from "~/features/pages/components/TagChip";
import type { loader } from "../search";

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

export function SearchView() {
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
      <h1 className="mb-4 text-lg font-semibold text-content-primary">{t("search.title")}</h1>

      {/* Mode toggle tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-surface-sunken p-1">
        <button
          type="button"
          onClick={() => handleModeSwitch("keyword")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode !== "ai"
              ? "bg-surface-raised text-content-primary shadow-sm"
              : "text-content-tertiary hover:text-content-primary"
          }`}
        >
          {t("search.mode_keyword")}
        </button>
        <button
          type="button"
          onClick={() => handleModeSwitch("ai")}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "ai"
              ? "bg-surface-raised text-content-primary shadow-sm"
              : "text-content-tertiary hover:text-content-primary"
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
            className="text-sm font-medium text-content-secondary whitespace-nowrap"
          >
            {t("search.filter_by_tag")}
          </label>
          <select
            id="tag-filter"
            value={tag}
            onChange={handleTagSelect}
            className="rounded-md border border-border-default bg-surface-raised px-2.5 py-1.5 text-sm text-content-secondary focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
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
              className="text-xs text-content-disabled hover:text-content-secondary"
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
          <p className="text-sm text-content-tertiary">{t("search.empty_query")}</p>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center gap-2 py-8 text-sm text-content-tertiary">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-border-focus border-t-transparent motion-reduce:animate-none" />
                {t("search.ai_searching")}
              </div>
            }
          >
            <Await resolve={ragResult ?? Promise.resolve(null)}>
              {(resolved) => <AiSearchResults q={q} ragResult={resolved} isJa={isJa} t={t} />}
            </Await>
          </Suspense>
        )
      ) : /* Keyword search results */
      !q && !tag ? (
        <p className="text-sm text-content-tertiary">{t("search.empty_query")}</p>
      ) : isNavigating ? (
        <ListSkeleton rows={5} />
      ) : results.length === 0 ? (
        <p className="text-sm text-content-tertiary">
          {tag && !q
            ? t("search.no_results_tag", { tag: activeTagName })
            : t("search.no_results", { query: q })}
        </p>
      ) : (
        <>
          <p className="mb-6 text-sm text-content-tertiary">
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
                    className="block rounded-lg border border-border-default bg-surface-raised p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-border-focus/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-content-primary hover:text-action-primary">
                      {title}
                    </span>

                    {summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-content-tertiary">{summary}</p>
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
                        <time className="ml-auto text-xs text-content-disabled">
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
  t,
}: {
  q: string;
  ragResult: AiRagResult | null;
  isJa: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!q) {
    return <p className="text-sm text-content-tertiary">{t("search.empty_query")}</p>;
  }

  if (!ragResult) {
    return <p className="text-sm text-content-tertiary">{t("search.ai_error")}</p>;
  }

  if (!ragResult.ragAvailable) {
    return <p className="text-sm text-content-tertiary">{t("search.ai_unavailable")}</p>;
  }

  if (!ragResult.answer && ragResult.sources.length === 0) {
    return <p className="text-sm text-content-tertiary">{t("search.ai_no_results")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* AI Answer card */}
      {ragResult.answer && (
        <div className="rounded-lg border border-feedback-info-border bg-feedback-info-surface/50 p-4  ">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-action-primary-hover ">
            <span className="text-base">&#10022;</span>
            {t("search.ai_answer")}
          </div>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-content-primary">
            {ragResult.answer}
          </div>
        </div>
      )}

      {/* Source pages */}
      {ragResult.sources.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-content-secondary">
            {t("search.ai_sources")}
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
                    className="block rounded-lg border border-border-default bg-surface-raised p-4 transition-[border-color,box-shadow] duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] hover:border-border-focus/40 hover:shadow-sm"
                  >
                    <span className="font-medium text-content-primary hover:text-action-primary">
                      {title}
                    </span>

                    {summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-content-tertiary">{summary}</p>
                    )}

                    <div className="mt-2 text-xs text-content-disabled">
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
