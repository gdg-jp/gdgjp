import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import { ListSkeleton } from "~/components/Skeleton";

interface FavoritePage {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
}

interface FavoritesData {
  favorites: FavoritePage[];
}

interface ToggleData {
  ok: boolean;
  starred: boolean;
}

export interface StarredContentProps {
  lang: "ja" | "en";
  currentPageId?: string;
  currentPageTitle?: string;
  isStarred?: boolean;
  onStarChange?: (starred: boolean) => void;
  onClose: () => void;
  open: boolean;
}

// Module-level cache — survives component unmounts (popover close/reopen)
let cachedFavorites: FavoritesData | null = null;

export default function StarredContent({
  lang,
  currentPageId,
  currentPageTitle,
  isStarred = false,
  onStarChange,
  onClose,
  open,
}: StarredContentProps) {
  const { t } = useTranslation();
  const listFetcher = useFetcher<FavoritesData>();
  const toggleFetcher = useFetcher<ToggleData>();
  const [query, setQuery] = useState("");

  if (listFetcher.data) cachedFavorites = listFetcher.data;

  const loadFavorites = useCallback(() => {
    listFetcher.load("/api/favorites");
  }, [listFetcher.load]);

  // Load favorites when opened
  useEffect(() => {
    if (open) {
      loadFavorites();
      setQuery("");
    }
  }, [open, loadFavorites]);

  // Sync star state after toggle
  useEffect(() => {
    if (toggleFetcher.data?.ok) {
      onStarChange?.(toggleFetcher.data.starred);
      loadFavorites();
    }
  }, [toggleFetcher.data, onStarChange, loadFavorites]);

  const data = cachedFavorites;
  const isFirstLoad = listFetcher.state === "loading" && !data;

  const favorites = data?.favorites ?? [];
  const otherFavorites = favorites.filter((f) => f.id !== currentPageId);
  const filtered = otherFavorites.filter((f) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return f.titleJa.toLowerCase().includes(q) || f.titleEn.toLowerCase().includes(q);
  });

  const optimisticStarred =
    toggleFetcher.state !== "idle"
      ? toggleFetcher.formData?.get("pageId") === currentPageId
        ? !isStarred
        : isStarred
      : isStarred;

  function handleToggle() {
    if (!currentPageId) return;
    toggleFetcher.submit(
      { intent: "toggle", pageId: currentPageId },
      { method: "post", action: "/api/favorites" },
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">{t("wiki.starred_dialog_title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Current page (only shown when inside a wiki page) */}
      {currentPageId && currentPageTitle && (
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {t("wiki.this_page")}
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm text-gray-700">{currentPageTitle}</span>
            <button
              type="button"
              onClick={handleToggle}
              disabled={toggleFetcher.state !== "idle"}
              className={[
                "shrink-0 rounded px-3 py-1 text-xs font-medium transition-colors",
                optimisticStarred
                  ? "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              ].join(" ")}
            >
              {optimisticStarred ? t("wiki.star_remove") : t("wiki.star_add")}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="px-5 pt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("wiki.search_starred")}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
        />
      </div>

      {/* List */}
      <div className="max-h-64 overflow-y-auto px-5 py-3">
        {isFirstLoad ? (
          <ListSkeleton rows={4} />
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">
            {query ? `"${query}" — 0` : t("wiki.starred_empty")}
          </p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((page) => (
              <li key={page.id}>
                <Link
                  to={`/wiki/${page.slug}`}
                  onClick={onClose}
                  className="block truncate rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 hover:text-blue-600"
                >
                  {lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
