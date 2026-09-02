import { diffLines } from "diff";
import { History } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/preview.css";
import { Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useFetcher } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { ArticleWithTitleSkeleton, ListSkeleton } from "~/components/Skeleton";
import { useThemeMode } from "~/hooks/useThemeMode";
import type { loader } from "../history";

type HistoryLoaderData = Awaited<ReturnType<typeof loader>>;

function relativeTimeDiff(savedAt: number): { key: string; count?: number } {
  const diffMs = Date.now() - savedAt * 1000;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return { key: "time.just_now" };
  if (diffMins < 60) return { key: "time.minutes_ago", count: diffMins };
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return { key: "time.hours_ago", count: diffHours };
  return { key: "time.days_ago", count: Math.floor(diffHours / 24) };
}

type VersionRow = {
  id: string;
  titleJa: string;
  titleEn: string;
  editedBy: string;
  savedAt: number;
  editorName: string | null;
};

type SelectedVersion = {
  id: string;
  titleJa: string;
  titleEn: string;
  contentJa: string;
  contentEn: string;
  savedAt: number;
  editorName: string | null;
} | null;

function HistoryContent({
  page,
  lang,
  pageTitle,
  versions,
  selectedVersion,
  canRevert,
  currentContentJa,
  currentContentEn,
}: {
  page: HistoryLoaderData["page"];
  lang: "ja" | "en";
  pageTitle: string;
  versions: VersionRow[];
  selectedVersion: SelectedVersion;
  canRevert: boolean;
  currentContentJa: string;
  currentContentEn: string;
}) {
  const { t } = useTranslation("common");
  const theme = useThemeMode();
  const [diffMode, setDiffMode] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const revertFetcher = useFetcher();

  const versionUrl = (vId: string, l = lang) => {
    const p = new URLSearchParams({ lang: l, v: vId });
    return `/wiki/${page.slug}/history?${p}`;
  };

  const langUrl = (l: string) => {
    const p = new URLSearchParams({ lang: l });
    if (selectedVersion) p.set("v", selectedVersion.id);
    return `/wiki/${page.slug}/history?${p}`;
  };

  const displayTitle = selectedVersion
    ? lang === "en"
      ? selectedVersion.titleEn || selectedVersion.titleJa
      : selectedVersion.titleJa || selectedVersion.titleEn
    : null;

  const versionContent = selectedVersion
    ? lang === "en"
      ? selectedVersion.contentEn || selectedVersion.contentJa
      : selectedVersion.contentJa || selectedVersion.contentEn
    : null;

  const currentContent =
    lang === "en" ? currentContentEn || currentContentJa : currentContentJa || currentContentEn;

  const diffResult =
    diffMode && selectedVersion && versionContent
      ? diffLines(currentContent ?? "", versionContent)
      : null;

  const isReverting = revertFetcher.state !== "idle";

  return (
    <div className="flex flex-1 gap-0 px-4 py-4 md:px-10 md:py-6">
      {/* Left: version list */}
      <aside className="mr-6 w-56 shrink-0 border-r border-border-subtle pr-4">
        {versions.length === 0 ? (
          <p className="text-sm text-content-disabled">{t("wiki.history_empty")}</p>
        ) : (
          <ul className="space-y-1">
            {/* "Current" entry linking back to live page */}
            <li>
              <Link
                to={page.wikiPath}
                className="block rounded-md px-3 py-2 text-sm text-content-tertiary hover:bg-surface-hover"
              >
                <div className="font-medium text-content-secondary">
                  {t("wiki.history_current")}
                </div>
                <div className="truncate text-xs text-content-disabled">{pageTitle}</div>
              </Link>
            </li>

            {versions.map((v) => {
              const isActive = selectedVersion?.id === v.id;
              const rt = relativeTimeDiff(v.savedAt);
              const timeStr = rt.count !== undefined ? t(rt.key, { count: rt.count }) : t(rt.key);
              return (
                <li key={v.id}>
                  <Link
                    to={versionUrl(v.id)}
                    className={[
                      "block rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "border-l-2 border-border-focus bg-feedback-info-surface text-action-primary-hover"
                        : "text-content-secondary hover:bg-surface-hover",
                    ].join(" ")}
                  >
                    <div className="truncate font-medium">
                      {lang === "en" ? v.titleEn || v.titleJa : v.titleJa || v.titleEn}
                    </div>
                    <div className="mt-0.5 text-xs text-content-disabled">
                      {v.editorName ?? v.editedBy.slice(0, 8)}
                      {" · "}
                      {timeStr}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Right: content preview */}
      <div className="min-w-0 flex-1">
        {/* Language tabs + Preview/Diff toggle */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex w-fit shrink-0 gap-1 rounded-md border border-border-default bg-surface-raised p-0.5">
            {(["ja", "en"] as const).map((l) => {
              const isActive = lang === l;
              return (
                <Link
                  key={l}
                  to={langUrl(l)}
                  className={[
                    "min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors",
                    isActive
                      ? "bg-action-primary text-action-primary-foreground"
                      : "text-content-secondary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  {l === "ja" ? "JA" : "EN"}
                </Link>
              );
            })}
          </div>

          {selectedVersion && (
            <div className="flex w-fit gap-1 rounded-md border border-border-default bg-surface-raised p-0.5">
              <button
                type="button"
                onClick={() => setDiffMode(false)}
                className={[
                  "rounded px-2 py-1 text-sm font-medium transition-colors",
                  !diffMode
                    ? "bg-action-primary text-action-primary-foreground"
                    : "text-content-secondary hover:bg-surface-hover",
                ].join(" ")}
              >
                {t("wiki.history_preview")}
              </button>
              <button
                type="button"
                onClick={() => setDiffMode(true)}
                className={[
                  "rounded px-2 py-1 text-sm font-medium transition-colors",
                  diffMode
                    ? "bg-action-primary text-action-primary-foreground"
                    : "text-content-secondary hover:bg-surface-hover",
                ].join(" ")}
              >
                {t("wiki.history_diff")}
              </button>
            </div>
          )}
        </div>

        {selectedVersion ? (
          <>
            <h1 className="mb-4 text-2xl font-bold text-content-primary">{displayTitle}</h1>

            {diffMode && diffResult ? (
              <pre className="overflow-x-auto rounded-lg border border-border-default bg-surface-sunken p-4 text-sm leading-relaxed">
                {diffResult.map((part, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable diff output
                    key={i}
                    className={
                      part.added
                        ? "bg-feedback-success-surface text-feedback-success-foreground"
                        : part.removed
                          ? "bg-feedback-danger-surface text-feedback-danger-foreground line-through"
                          : "text-content-secondary"
                    }
                  >
                    {part.value
                      .split("\n")
                      .filter(
                        (_, idx, arr) =>
                          idx < arr.length - 1 || part.value.endsWith("\n") || arr.length === 1,
                      )
                      .map((line, lineIdx) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: stable line output
                        <span key={lineIdx} className="block whitespace-pre">
                          {part.added ? "+ " : part.removed ? "- " : "  "}
                          {line}
                        </span>
                      ))}
                  </div>
                ))}
              </pre>
            ) : versionContent ? (
              <MdPreview
                modelValue={versionContent}
                theme={theme}
                autoFoldThreshold={Number.POSITIVE_INFINITY}
              />
            ) : (
              <p className="text-content-disabled">{t("wiki.history_no_content")}</p>
            )}

            {canRevert && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setRevertOpen(true)}
                  disabled={isReverting}
                  className="rounded-md bg-feedback-warning-solid px-4 py-2 text-sm font-medium text-feedback-warning-solid-foreground hover:bg-feedback-warning-solid disabled:opacity-60"
                >
                  {isReverting ? t("wiki.history_reverting") : t("wiki.history_revert")}
                </button>
              </div>
            )}

            <ConfirmDialog
              open={revertOpen}
              title={t("wiki.history_revert_title")}
              message={t("wiki.history_revert_confirm")}
              confirmLabel={t("wiki.history_revert")}
              cancelLabel={t("cancel")}
              onConfirm={() => {
                setRevertOpen(false);
                revertFetcher.submit(
                  { intent: "revert", versionId: selectedVersion.id },
                  { method: "post" },
                );
              }}
              onCancel={() => setRevertOpen(false)}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-content-disabled">
            <History size={32} className="mb-3 opacity-30" />
            <p className="text-sm">{t("wiki.history_empty")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function HistoryView({ page, lang, historyData }: HistoryLoaderData) {
  const { t } = useTranslation("common");
  const pageTitle = lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  return (
    <div className="flex min-h-full flex-col">
      {/* Mini-header */}
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-2 md:px-10">
        <Link
          to={page.wikiPath}
          className="text-sm text-content-tertiary hover:text-content-primary"
        >
          ← {pageTitle}
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-medium text-content-secondary">
          <History size={14} />
          {t("wiki.history")}
        </div>
      </div>

      <Suspense
        fallback={
          <div className="flex flex-1 gap-0 px-4 py-4 md:px-10 md:py-6">
            <aside className="mr-6 w-56 shrink-0 border-r border-border-subtle pr-4">
              <ListSkeleton rows={5} />
            </aside>
            <div className="flex-1">
              <ArticleWithTitleSkeleton />
            </div>
          </div>
        }
      >
        <Await
          resolve={historyData}
          errorElement={
            <div className="p-6 text-sm text-feedback-danger-foreground">
              Failed to load page history.
            </div>
          }
        >
          {(resolvedData) => (
            <HistoryContent
              page={page}
              lang={lang}
              pageTitle={pageTitle}
              versions={resolvedData.versions}
              selectedVersion={resolvedData.selectedVersion}
              canRevert={resolvedData.canRevert}
              currentContentJa={resolvedData.currentContentJa}
              currentContentEn={resolvedData.currentContentEn}
            />
          )}
        </Await>
      </Suspense>
    </div>
  );
}
