import { Archive, History, MoreHorizontal, Pencil, Share2, Star } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useFetcher } from "react-router";
import { Skeleton } from "~/components/Skeleton";
import Tooltip from "~/components/Tooltip";

const btnBase =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-content-tertiary transition-colors hover:bg-surface-hover hover:text-content-primary";

type PageSlice = {
  id: string;
  slug: string;
  translationStatusJa: string;
  translationStatusEn: string;
};

function StarButton({ pageId, initialStarred }: { pageId: string; initialStarred: boolean }) {
  const { t } = useTranslation("common");
  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const [currentStarred, setCurrentStarred] = useState(initialStarred);

  useEffect(() => {
    setCurrentStarred(initialStarred);
  }, [initialStarred]);

  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;
  const starStyle = optimisticStarred
    ? { color: "var(--color-feedback-warning-solid)" }
    : undefined;
  const starIconStyle = optimisticStarred
    ? {
        fill: "var(--color-feedback-warning-solid)",
        color: "var(--color-feedback-warning-solid)",
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={() => favFetcher.submit({ intent: "toggleFavorite", pageId }, { method: "post" })}
      className={btnBase}
      style={starStyle}
    >
      <Star size={14} style={starIconStyle} />
      {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
    </button>
  );
}

function MobileStarButton({
  pageId,
  initialStarred,
  onSelect,
}: {
  pageId: string;
  initialStarred: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation("common");
  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const [currentStarred, setCurrentStarred] = useState(initialStarred);

  useEffect(() => {
    setCurrentStarred(initialStarred);
  }, [initialStarred]);

  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;
  const starStyle = optimisticStarred
    ? { color: "var(--color-feedback-warning-solid)" }
    : undefined;
  const starIconStyle = optimisticStarred
    ? {
        fill: "var(--color-feedback-warning-solid)",
        color: "var(--color-feedback-warning-solid)",
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={() => {
        favFetcher.submit({ intent: "toggleFavorite", pageId }, { method: "post" });
        onSelect();
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
      style={starStyle}
    >
      <Star size={14} style={starIconStyle} />
      {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
    </button>
  );
}

/** Mini-header for `/wiki/*` — JA/EN toggle + edit/history/star/share/archive. */
export function WikiPageToolbar({
  page,
  lang,
  jaUrl,
  enUrl,
  canEdit,
  isAuthenticated,
  canArchive,
  pageMeta,
  onShare,
  onArchive,
}: {
  page: PageSlice;
  lang: "ja" | "en";
  jaUrl: string;
  enUrl: string;
  canEdit: boolean;
  isAuthenticated: boolean;
  canArchive: boolean;
  pageMeta: Promise<{ isStarred: boolean }>;
  onShare: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation("common");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-2 md:px-10">
      <div className="flex shrink-0 gap-1 rounded-md border border-border-default bg-surface-raised p-0.5">
        {(["ja", "en"] as const).map((l) => {
          const status = l === "ja" ? page.translationStatusJa : page.translationStatusEn;
          const isPending = status === "missing";
          const isActive = lang === l;
          const className = [
            "min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors",
            isActive
              ? "bg-action-primary text-action-primary-foreground"
              : isPending
                ? "text-content-disabled"
                : "text-content-secondary hover:bg-surface-hover",
          ].join(" ");

          if (isPending) {
            return (
              <span
                key={l}
                aria-disabled="true"
                title={t("wiki.translation_pending")}
                className={className}
              >
                {l === "ja" ? "JA" : "EN"}
              </span>
            );
          }

          return (
            <Link key={l} to={l === "ja" ? jaUrl : enUrl} className={className}>
              {l === "ja" ? "JA" : "EN"}
            </Link>
          );
        })}
      </div>
      {/* Desktop action buttons (md+) */}
      <div className="hidden items-center gap-1 md:flex">
        {canEdit && (
          <Link to={`/wiki/${page.slug}/edit`} className={btnBase}>
            <Pencil size={14} />
            {t("wiki.edit")}
          </Link>
        )}
        <Link to={`/wiki/${page.slug}/history`} className={btnBase}>
          <History size={14} />
          {t("wiki.history")}
        </Link>
        {isAuthenticated && (
          <>
            <Suspense fallback={<Skeleton className="h-7 w-16" />}>
              <Await resolve={pageMeta} errorElement={null}>
                {(meta) => (
                  <StarButton pageId={page.id} initialStarred={meta?.isStarred ?? false} />
                )}
              </Await>
            </Suspense>
            <button type="button" onClick={onShare} className={btnBase}>
              <Share2 size={14} />
              {t("wiki.share")}
            </button>
          </>
        )}
        <Tooltip label={t("wiki.archive_no_permission")} disabled={!canArchive}>
          <button
            type="button"
            onClick={canArchive ? onArchive : undefined}
            disabled={!canArchive}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-content-tertiary transition-colors hover:bg-feedback-warning-surface hover:text-feedback-warning-foreground disabled:opacity-50"
          >
            <Archive size={14} />
            {t("wiki.archive")}
          </button>
        </Tooltip>
      </div>

      {/* Mobile "more" dropdown (<md) */}
      <div ref={moreRef} className="relative md:hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className={btnBase}
          aria-label="More actions"
        >
          <MoreHorizontal size={16} />
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border-default bg-surface-raised py-1 shadow-lg">
            {canEdit && (
              <Link
                to={`/wiki/${page.slug}/edit`}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
                onClick={() => setMoreOpen(false)}
              >
                <Pencil size={14} />
                {t("wiki.edit")}
              </Link>
            )}
            <Link
              to={`/wiki/${page.slug}/history`}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
              onClick={() => setMoreOpen(false)}
            >
              <History size={14} />
              {t("wiki.history")}
            </Link>
            {isAuthenticated && (
              <Suspense
                fallback={
                  <div className="px-3 py-2">
                    <Skeleton className="h-4 w-20" />
                  </div>
                }
              >
                <Await resolve={pageMeta} errorElement={null}>
                  {(meta) => (
                    <MobileStarButton
                      pageId={page.id}
                      initialStarred={meta?.isStarred ?? false}
                      onSelect={() => setMoreOpen(false)}
                    />
                  )}
                </Await>
              </Suspense>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => {
                  onShare();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
              >
                <Share2 size={14} />
                {t("wiki.share")}
              </button>
            )}
            <Tooltip label={t("wiki.archive_no_permission")} disabled={!canArchive}>
              <button
                type="button"
                onClick={
                  canArchive
                    ? () => {
                        onArchive();
                        setMoreOpen(false);
                      }
                    : undefined
                }
                disabled={!canArchive}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-feedback-warning-surface hover:text-feedback-warning-foreground disabled:opacity-50"
              >
                <Archive size={14} />
                {t("wiki.archive")}
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
