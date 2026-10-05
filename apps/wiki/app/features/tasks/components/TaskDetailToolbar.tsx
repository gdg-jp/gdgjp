import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useFetcher } from "react-router";
import Tooltip from "~/components/Tooltip";

import { Icons } from "@gdgjp/design-system";
const btnBase =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-neutral hover:text-foreground";

function TaskStarButton({ pageId, initialStarred }: { pageId: string; initialStarred: boolean }) {
  const { t } = useTranslation();
  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const [currentStarred, setCurrentStarred] = useState(initialStarred);
  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;

  useEffect(() => {
    setCurrentStarred(initialStarred);
  }, [initialStarred]);

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
      <Icons name="Star" size={14} style={starIconStyle} />
      {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
    </button>
  );
}

function MobileTaskStarButton({
  pageId,
  initialStarred,
  onSelect,
}: {
  pageId: string;
  initialStarred: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const [currentStarred, setCurrentStarred] = useState(initialStarred);
  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;

  useEffect(() => {
    setCurrentStarred(initialStarred);
  }, [initialStarred]);

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
      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-neutral"
      style={starStyle}
    >
      <Icons name="Star" size={14} style={starIconStyle} />
      {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
    </button>
  );
}

/** Mini-header toolbar for `/tasks/:slug` — desktop buttons + mobile "more" menu. */
export function TaskDetailToolbar({
  slug,
  pageId,
  isAuthenticated,
  canArchive,
  taskData,
  onShare,
  onArchive,
}: {
  slug: string;
  pageId: string;
  isAuthenticated: boolean;
  canArchive: boolean;
  taskData: Promise<{ isStarred: boolean }>;
  onShare: () => void;
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close "more" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  return (
    <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2 md:px-10">
      {/* Desktop action buttons (md+) */}
      <div className="hidden items-center gap-1 md:flex">
        <Link to={`/tasks/${slug}/history`} className={btnBase}>
          <Icons name="History" size={14} />
          {t("tasks.history")}
        </Link>
        {isAuthenticated && (
          <Suspense
            fallback={
              <div className="h-7 w-16 rounded bg-neutral animate-pulse motion-reduce:animate-none" />
            }
          >
            <Await resolve={taskData} errorElement={null}>
              {({ isStarred }) => <TaskStarButton pageId={pageId} initialStarred={isStarred} />}
            </Await>
          </Suspense>
        )}
        {isAuthenticated && (
          <button type="button" onClick={onShare} className={btnBase}>
            <Icons name="Share2" size={14} />
            {t("wiki.share")}
          </button>
        )}
        <Tooltip label={t("tasks.archive_no_permission")} disabled={!canArchive}>
          <button
            type="button"
            onClick={canArchive ? onArchive : undefined}
            disabled={!canArchive}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-[var(--gdg-warning-surface)] hover:text-warning disabled:opacity-50"
          >
            <Icons name="Archive" size={14} />
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
          <Icons name="MoreHorizontal" size={16} />
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-border bg-surface py-1 shadow-lg">
            <Link
              to={`/tasks/${slug}/history`}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-neutral"
              onClick={() => setMoreOpen(false)}
            >
              <Icons name="History" size={14} />
              {t("tasks.history")}
            </Link>
            {isAuthenticated && (
              <Suspense
                fallback={
                  <div className="h-8 w-full rounded bg-neutral animate-pulse motion-reduce:animate-none" />
                }
              >
                <Await resolve={taskData} errorElement={null}>
                  {({ isStarred }) => (
                    <MobileTaskStarButton
                      pageId={pageId}
                      initialStarred={isStarred}
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-neutral"
              >
                <Icons name="Share2" size={14} />
                {t("wiki.share")}
              </button>
            )}
            <Tooltip label={t("tasks.archive_no_permission")} disabled={!canArchive}>
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-[var(--gdg-warning-surface)] hover:text-warning disabled:opacity-50"
              >
                <Icons name="Archive" size={14} />
                {t("wiki.archive")}
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
