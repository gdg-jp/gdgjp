import { RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useFetcher } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { ListSkeleton } from "~/components/Skeleton";
import { timeAgo } from "~/lib/time";

interface ArchivedPage {
  id: string;
  slug: string;
  titleJa: string;
  titleEn: string;
  updatedAt: string | null;
  authorId: string;
}

interface ArchivedData {
  pages: ArchivedPage[];
  isAdmin: boolean;
  isLead: boolean;
  currentUserId: string;
}

interface ArchivedContentProps {
  open: boolean;
  onClose: () => void;
  lang: "ja" | "en";
}

// Module-level cache — survives component unmounts (popover close/reopen)
let cachedArchived: ArchivedData | null = null;

export default function ArchivedContent({ open, onClose, lang }: ArchivedContentProps) {
  const { t } = useTranslation();
  const listFetcher = useFetcher<ArchivedData>();
  const actionFetcher = useFetcher<{ ok: boolean }>();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  if (listFetcher.data) cachedArchived = listFetcher.data;

  const loadArchived = useCallback(() => {
    listFetcher.load("/api/archived");
  }, [listFetcher.load]);

  useEffect(() => {
    if (open) loadArchived();
  }, [open, loadArchived]);

  // Reload list after a successful action
  useEffect(() => {
    if (actionFetcher.data?.ok) loadArchived();
  }, [actionFetcher.data, loadArchived]);

  const data = cachedArchived;
  const isFirstLoad = listFetcher.state === "loading" && !data;

  const pages = data?.pages ?? [];
  const isAdmin = data?.isAdmin ?? false;
  const isLead = data?.isLead ?? false;
  const currentUserId = data?.currentUserId ?? "";

  function title(page: ArchivedPage) {
    return lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">{t("archived.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto px-5 py-3">
        {isFirstLoad ? (
          <ListSkeleton rows={4} />
        ) : pages.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">{t("archived.empty")}</p>
        ) : (
          <ul className="space-y-1">
            {pages.map((page) => {
              const canRestore = page.authorId === currentUserId || isLead;
              const canDelete = isAdmin;
              const pageTitle = title(page);
              return (
                <li
                  key={page.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-800">
                      {pageTitle}
                    </span>
                    {page.updatedAt && (
                      <span className="text-xs text-gray-400">
                        {timeAgo(new Date(page.updatedAt), t)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {canRestore && (
                      <button
                        type="button"
                        disabled={actionFetcher.state !== "idle"}
                        onClick={() =>
                          actionFetcher.submit(
                            { intent: "restorePage", pageId: page.id },
                            { method: "post", action: "/api/archived" },
                          )
                        }
                        className="rounded p-1 text-gray-400 hover:bg-green-50 hover:text-green-600"
                        title={t("archived.restore")}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        disabled={actionFetcher.state !== "idle"}
                        onClick={() => setDeleteTarget({ id: page.id, title: pageTitle })}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title={t("archived.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* View all footer */}
      <div className="border-t border-gray-100 px-5 py-3">
        <Link
          to="/archived"
          onClick={onClose}
          className="block text-center text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {t("archived.view_all")}
        </Link>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t("archived.delete")}
        message={t("archived.delete_confirm", { title: deleteTarget?.title })}
        confirmLabel={t("archived.delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            actionFetcher.submit(
              { intent: "deletePage", pageId: deleteTarget.id },
              { method: "post", action: "/api/archived" },
            );
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
