import { Archive, History, MoreHorizontal, Share2, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import Tooltip from "~/components/Tooltip";

const btnBase =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-content-tertiary transition-colors hover:bg-surface-hover hover:text-content-primary";

/** Mini-header toolbar for `/tasks/:slug` — desktop buttons + mobile "more" menu. */
export function TaskDetailToolbar({
  slug,
  isAuthenticated,
  canArchive,
  optimisticStarred,
  onToggleStar,
  onShare,
  onArchive,
}: {
  slug: string;
  isAuthenticated: boolean;
  canArchive: boolean;
  optimisticStarred: boolean;
  onToggleStar: () => void;
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
    <div className="flex items-center justify-end gap-2 border-b border-border-subtle px-4 py-2 md:px-10">
      {/* Desktop action buttons (md+) */}
      <div className="hidden items-center gap-1 md:flex">
        <Link to={`/tasks/${slug}/history`} className={btnBase}>
          <History size={14} />
          {t("tasks.history")}
        </Link>
        {isAuthenticated && (
          <button type="button" onClick={onToggleStar} className={btnBase} style={starStyle}>
            <Star size={14} style={starIconStyle} />
            {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
          </button>
        )}
        {isAuthenticated && (
          <button type="button" onClick={onShare} className={btnBase}>
            <Share2 size={14} />
            {t("wiki.share")}
          </button>
        )}
        <Tooltip label={t("tasks.archive_no_permission")} disabled={!canArchive}>
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
            <Link
              to={`/tasks/${slug}/history`}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
              onClick={() => setMoreOpen(false)}
            >
              <History size={14} />
              {t("tasks.history")}
            </Link>
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => {
                  onToggleStar();
                  setMoreOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-hover"
                style={starStyle}
              >
                <Star size={14} style={starIconStyle} />
                {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
              </button>
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
