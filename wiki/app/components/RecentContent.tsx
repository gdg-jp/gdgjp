import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { ListSkeleton } from "~/components/Skeleton";
import { timeAgo } from "~/lib/time";

interface RecentPage {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  updatedAt?: string | null;
  viewedAt?: string | null;
}

interface RecentData {
  recentUpdated: RecentPage[];
  recentViewed: RecentPage[];
}

interface RecentContentProps {
  open: boolean;
  onClose: () => void;
  lang: "ja" | "en";
}

// Module-level cache — survives component unmounts (popover close/reopen)
let cachedRecent: RecentData | null = null;

export default function RecentContent({ open, onClose, lang }: RecentContentProps) {
  const { t } = useTranslation();
  const fetcher = useFetcher<RecentData>();

  if (fetcher.data) cachedRecent = fetcher.data;

  const loadRecent = useCallback(() => {
    fetcher.load("/api/recent");
  }, [fetcher.load]);

  useEffect(() => {
    if (open) loadRecent();
  }, [open, loadRecent]);

  const data = cachedRecent;
  const isFirstLoad = fetcher.state === "loading" && !data;

  const viewed = data?.recentViewed ?? [];
  const updated = data?.recentUpdated ?? [];

  function title(page: RecentPage) {
    return lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">{t("recent.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {/* Recently Viewed */}
        <div className="px-5 pt-3 pb-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("recent.recently_viewed")}
          </p>
          {isFirstLoad ? (
            <ListSkeleton rows={3} />
          ) : viewed.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">{t("recent.no_viewed")}</p>
          ) : (
            <ul className="space-y-0.5">
              {viewed.map((page) => (
                <li key={page.id}>
                  <Link
                    to={`/wiki/${page.slug}`}
                    onClick={onClose}
                    className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-blue-600"
                  >
                    <span className="truncate">{title(page)}</span>
                    {page.viewedAt && (
                      <span className="shrink-0 text-xs text-gray-400">
                        {timeAgo(new Date(page.viewedAt), t)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recently Updated */}
        <div className="px-5 pt-2 pb-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("recent.recently_updated")}
          </p>
          {isFirstLoad ? (
            <ListSkeleton rows={3} />
          ) : updated.length === 0 ? (
            <p className="py-2 text-sm text-gray-400">{t("recent.no_updated")}</p>
          ) : (
            <ul className="space-y-0.5">
              {updated.map((page) => (
                <li key={page.id}>
                  <Link
                    to={`/wiki/${page.slug}`}
                    onClick={onClose}
                    className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-blue-600"
                  >
                    <span className="truncate">{title(page)}</span>
                    {page.updatedAt && (
                      <span className="shrink-0 text-xs text-gray-400">
                        {timeAgo(new Date(page.updatedAt), t)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* View all footer */}
      <div className="border-t border-gray-100 px-5 py-3">
        <Link
          to="/recent"
          onClick={onClose}
          className="block text-center text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {t("recent.view_all")}
        </Link>
      </div>
    </>
  );
}
