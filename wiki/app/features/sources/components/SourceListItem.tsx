import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gdgjp/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@gdgjp/ui";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { isSourceVisibility, sourceVisibilityNeedsChapter } from "~/features/sources/shared";
import { timeAgo } from "~/lib/time";
import { ChapterSelect, VisibilitySelect, statusBadgeClass } from "./source-selects";

import { Icons } from "@gdgjp/ui";
export type SourceListItemSource = {
  id: string;
  title: string;
  url: string;
  kind: string;
  status: string;
  visibility: string;
  chapterId: string | null;
  addedBy: string;
  errorMessage: string | null;
  lastFetchedAt: Date | string | null;
  documents: Array<{
    id: string;
    path: string;
    title: string;
    contentHash: string;
    mediaType: string;
    capturedAt: Date | string;
    status: string;
  }>;
};

type Chapter = { id: string; nameJa: string; nameEn: string };

export default function SourceListItem({
  source,
  open,
  onToggle,
  assignableChapters,
  allChapters,
  canEditVisibility,
  language,
}: {
  source: SourceListItemSource;
  open: boolean;
  onToggle: () => void;
  assignableChapters: Chapter[];
  allChapters: Chapter[];
  canEditVisibility: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  const refreshFetcher = useFetcher();
  const archiveFetcher = useFetcher();
  const unarchiveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const visibilityFetcher = useFetcher();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [editVisibility, setEditVisibility] = useState(source.visibility);
  const [editChapter, setEditChapter] = useState(source.chapterId ?? "");
  const editNeedsChapter =
    isSourceVisibility(editVisibility) && sourceVisibilityNeedsChapter(editVisibility);
  const busy =
    refreshFetcher.state !== "idle" ||
    archiveFetcher.state !== "idle" ||
    unarchiveFetcher.state !== "idle" ||
    deleteFetcher.state !== "idle" ||
    visibilityFetcher.state !== "idle";

  const fetchedLabel = source.lastFetchedAt
    ? timeAgo(new Date(source.lastFetchedAt), t)
    : t("sources.never_fetched");
  const visibilityLabel = isSourceVisibility(source.visibility)
    ? t(`sources.visibility.${source.visibility}`)
    : source.visibility;
  const chapterName = source.chapterId
    ? allChapters.find((chapter) => chapter.id === source.chapterId)
    : null;
  const visibilityDetail =
    chapterName &&
    isSourceVisibility(source.visibility) &&
    sourceVisibilityNeedsChapter(source.visibility)
      ? ` (${language.startsWith("en") ? chapterName.nameEn : chapterName.nameJa})`
      : "";

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-start gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={onToggle}
          className="mt-0.5 rounded p-1 text-muted hover:bg-neutral"
          aria-expanded={open}
          aria-label={t("sources.toggle_documents")}
        >
          {open ? <Icons name="ChevronDown" size={16} /> : <Icons name="ChevronRight" size={16} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="min-w-0 truncate text-sm font-medium text-foreground"
              title={source.title}
            >
              {source.title}
            </h2>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(source.status)}`}
            >
              {t(`sources.status.${source.status}`, source.status)}
            </span>
            <span className="inline-flex rounded-full bg-neutral px-2 py-0.5 text-xs font-medium text-muted">
              {t(`sources.kind.${source.kind}`, source.kind)}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-link hover:underline"
              title={source.url}
            >
              {source.url}
            </a>
            <span aria-hidden="true">·</span>
            <span>{t("sources.doc_count", { count: source.documents.length })}</span>
            <span aria-hidden="true">·</span>
            <span>{fetchedLabel}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-neutral px-2 py-0.5 text-xs font-medium text-muted">
              {visibilityLabel}
              {visibilityDetail}
            </span>
            {canEditVisibility ? (
              <Popover
                open={visibilityOpen}
                onOpenChange={(next) => {
                  setVisibilityOpen(next);
                  if (next) {
                    setEditVisibility(source.visibility);
                    setEditChapter(source.chapterId ?? "");
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-neutral"
                  >
                    <Icons name="Pencil" size={12} />
                    {t("sources.edit_visibility")}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 space-y-3 p-3">
                  <visibilityFetcher.Form
                    method="post"
                    className="space-y-2"
                    onSubmit={() => setVisibilityOpen(false)}
                  >
                    <input type="hidden" name="intent" value="update-visibility" />
                    <input type="hidden" name="sourceId" value={source.id} />
                    <VisibilitySelect
                      t={t}
                      value={editVisibility}
                      onValueChange={setEditVisibility}
                      className="w-full bg-surface"
                    />
                    {editNeedsChapter ? (
                      <ChapterSelect
                        chapters={assignableChapters}
                        language={language}
                        t={t}
                        value={editChapter}
                        onValueChange={setEditChapter}
                        className="w-full bg-surface"
                      />
                    ) : null}
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        !isSourceVisibility(editVisibility) ||
                        (editNeedsChapter && !editChapter)
                      }
                      className="rounded border border-border px-2 py-1 text-xs hover:bg-neutral disabled:opacity-50"
                    >
                      {t("sources.visibility_save")}
                    </button>
                    <input type="hidden" name="visibility" value={editVisibility} />
                    <input
                      type="hidden"
                      name="chapter"
                      value={editNeedsChapter ? editChapter : ""}
                    />
                  </visibilityFetcher.Form>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>

          {source.errorMessage ? (
            <p className="mt-2 text-xs text-danger">{source.errorMessage}</p>
          ) : null}
          {unarchiveFetcher.data && !unarchiveFetcher.data.ok ? (
            <p className="mt-1 text-xs text-danger">
              {t(`sources.error_${unarchiveFetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
          {deleteFetcher.data && !deleteFetcher.data.ok ? (
            <p className="mt-1 text-xs text-danger">
              {t(`sources.error_${deleteFetcher.data.error}`, {
                defaultValue: t("sources.error_generic"),
              })}
            </p>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="rounded p-1.5 text-muted hover:bg-neutral disabled:opacity-50"
              aria-label={t("sources.col_actions")}
            >
              <Icons name="MoreHorizontal" size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {source.status === "archived" ? (
              <>
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    unarchiveFetcher.submit(
                      { intent: "unarchive", sourceId: source.id },
                      { method: "post" },
                    )
                  }
                >
                  <Icons name="RefreshCw" size={14} />
                  {t("sources.unarchive")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={busy}
                  className="text-danger"
                  onSelect={() => setDeleteDialogOpen(true)}
                >
                  <Icons name="Trash2" size={14} />
                  {t("sources.delete")}
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    refreshFetcher.submit(
                      { intent: "refresh", sourceId: source.id },
                      { method: "post" },
                    )
                  }
                >
                  <Icons name="RefreshCw" size={14} />
                  {t("sources.refresh")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() =>
                    archiveFetcher.submit(
                      { intent: "archive", sourceId: source.id },
                      { method: "post" },
                    )
                  }
                >
                  {t("sources.archive")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        title={t("sources.delete")}
        message={t("sources.delete_confirm", { title: source.title })}
        confirmLabel={t("sources.delete")}
        cancelLabel={t("cancel")}
        destructive
        onConfirm={() => {
          deleteFetcher.submit({ intent: "delete", sourceId: source.id }, { method: "post" });
          setDeleteDialogOpen(false);
        }}
        onCancel={() => setDeleteDialogOpen(false)}
      />

      {open ? (
        <div className="bg-neutral px-4 py-3 sm:px-12">
          {source.documents.length === 0 ? (
            <p className="text-xs text-muted">{t("sources.no_documents")}</p>
          ) : (
            <ul className="space-y-2">
              {source.documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="font-medium text-foreground">{doc.title}</span>
                  <span className="text-muted">{doc.path}</span>
                  <span className="rounded bg-neutral px-1.5 py-0.5 font-mono text-muted">
                    {doc.mediaType}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-1.5 py-0.5 font-medium ${statusBadgeClass(doc.status)}`}
                  >
                    {t(`sources.status.${doc.status}`, doc.status)}
                  </span>
                  <span className="text-muted">{timeAgo(new Date(doc.capturedAt), t)}</span>
                  <span className="font-mono text-muted/70">{doc.contentHash.slice(0, 12)}…</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
