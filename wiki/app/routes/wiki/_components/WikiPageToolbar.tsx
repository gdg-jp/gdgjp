import { History, Pencil, Share2, Star } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useFetcher } from "react-router";
import { Skeleton } from "~/components/Skeleton";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";
import type { PageDisplay } from "~/features/pages/use-page-display";
import { PageActionsMenu } from "./PageActionsMenu";

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
}: {
  pageId: string;
  initialStarred: boolean;
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
    <DropdownMenuItem asChild>
      <button
        type="button"
        onClick={() => {
          favFetcher.submit({ intent: "toggleFavorite", pageId }, { method: "post" });
        }}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
        style={starStyle}
      >
        <Star size={14} style={starIconStyle} />
        {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
      </button>
    </DropdownMenuItem>
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
  title,
  content,
  display,
  onDisplayChange,
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
  title: string;
  content: Promise<{ contentJa: string; contentEn: string }>;
  display: PageDisplay;
  onDisplayChange: (value: PageDisplay) => void;
}) {
  const { t } = useTranslation("common");

  return (
    <div className="relative flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-2 md:px-10">
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
      <div className="ml-auto hidden items-center gap-1 md:flex">
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
      </div>

      <PageActionsMenu
        pageId={page.id}
        title={title}
        lang={lang}
        content={content}
        canManage={canArchive}
        onArchive={onArchive}
        display={display}
        onDisplayChange={onDisplayChange}
        mobileActions={
          <>
            {canEdit && (
              <DropdownMenuItem asChild>
                <Link to={`/wiki/${page.slug}/edit`}>
                  <Pencil size={14} />
                  {t("wiki.edit")}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link to={`/wiki/${page.slug}/history`}>
                <History size={14} />
                {t("wiki.history")}
              </Link>
            </DropdownMenuItem>
            {isAuthenticated && (
              <>
                <Suspense fallback={null}>
                  <Await resolve={pageMeta} errorElement={null}>
                    {(meta) => (
                      <MobileStarButton
                        pageId={page.id}
                        initialStarred={meta?.isStarred ?? false}
                      />
                    )}
                  </Await>
                </Suspense>
                <DropdownMenuItem onSelect={onShare}>
                  <Share2 size={14} />
                  {t("wiki.share")}
                </DropdownMenuItem>
              </>
            )}
          </>
        }
      />
    </div>
  );
}
