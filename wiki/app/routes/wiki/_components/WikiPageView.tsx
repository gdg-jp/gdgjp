import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/preview.css";
import { List } from "lucide-react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, Link, useFetcher, useLoaderData, useLocation } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { ListSkeleton } from "~/components/Skeleton";
import { parseMdHeadings } from "~/features/editor/toc";
import CommentSection from "~/features/pages/components/CommentSection";
import ShareDialog from "~/features/pages/components/ShareDialog";
import TagChip from "~/features/pages/components/TagChip";
import type { TocItem } from "~/features/pages/components/WikiRightSidebar";
import WikiRightSidebar from "~/features/pages/components/WikiRightSidebar";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useThemeMode } from "~/hooks/useThemeMode";
import type { loader } from "../page";
import { MobileContentsSheet } from "./MobileContentsSheet";
import { WikiPageToolbar } from "./WikiPageToolbar";

export function WikiPageView() {
  const {
    page,
    tags,
    author,
    editor,
    lang,
    isAdmin,
    isStarred,
    sources,
    attachments,
    comments,
    currentUserId,
    isAuthenticated,
    canComment,
    canEdit: canEditPage,
    canManageAccess,
    canChangeVisibility,
    visibility,
    canArchive,
  } = useLoaderData<typeof loader>();
  const { t } = useTranslation("common");
  const theme = useThemeMode();
  const location = useLocation();
  const contentLangFetcher = useFetcher();
  const submitRef = contentLangFetcher.submit;

  // Persist content lang selection only when it differs from the stored value.
  useEffect(() => {
    const stored = localStorage.getItem("content_lang");
    if (stored === lang) return;
    localStorage.setItem("content_lang", lang);
    submitRef({ lang }, { method: "post", action: "/api/set-content-lang" });
  }, [lang, submitRef]);

  const primaryContent = lang === "en" ? page.contentEn : page.contentJa;
  const fallbackContent = lang === "en" ? page.contentJa : page.contentEn;
  const title = lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  const hasContent = primaryContent && primaryContent.trim().length > 0;
  const hasFallback = !hasContent && fallbackContent && fallbackContent.trim().length > 0;
  const displayContent = hasContent ? primaryContent : (fallbackContent ?? "");

  const [tocItems, setTocItems] = useState<TocItem[]>(() => parseMdHeadings(displayContent));
  const canEdit = canEditPage;

  // Stable callback — avoids re-render loop when MdPreview fires onGetCatalog every render
  const handleGetCatalog = useCallback((list: Array<{ text: string; level: number }>) => {
    setTocItems((prev) => {
      const next = list
        .filter((h) => h.level === 2 || h.level === 3)
        .map((h) => ({ id: h.text, text: h.text, level: h.level }));
      if (
        prev.length === next.length &&
        prev.every((item, i) => item.id === next[i].id && item.level === next[i].level)
      ) {
        return prev; // same data → same reference → no re-render
      }
      return next;
    });
  }, []);

  const favFetcher = useFetcher<{ ok: boolean; starred: boolean }>();
  const archiveFetcher = useFetcher();
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [currentStarred, setCurrentStarred] = useState(isStarred);
  const [shareOpen, setShareOpen] = useState(false);
  const [mobileContentsOpen, setMobileContentsOpen] = useState(false);
  const mobileContentsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Sync with loader when navigating to a different page
  useEffect(() => {
    setCurrentStarred(isStarred);
  }, [isStarred]);

  // Close mobile contents sheet on route change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on pathname change
  useEffect(() => {
    setMobileContentsOpen(false);
  }, [location.pathname]);

  const closeMobileContents = useCallback(() => {
    setMobileContentsOpen(false);
    const restoreTarget = previousFocusedElementRef.current ?? mobileContentsTriggerRef.current;
    if (restoreTarget) {
      window.requestAnimationFrame(() => restoreTarget.focus());
    }
  }, []);

  const openMobileContents = useCallback(() => {
    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileContentsOpen(true);
  }, []);

  // Optimistic star state for the action bar toggle
  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;

  function handleToggleStar() {
    favFetcher.submit({ intent: "toggleFavorite", pageId: page.id }, { method: "post" });
  }

  function handleShare() {
    setShareOpen(true);
  }

  const jaUrl = `${location.pathname}?lang=ja`;
  const enUrl = `${location.pathname}?lang=en`;

  return (
    <div>
      <WikiPageToolbar
        page={page}
        lang={lang}
        jaUrl={jaUrl}
        enUrl={enUrl}
        canEdit={canEdit}
        isAuthenticated={isAuthenticated}
        canArchive={canArchive}
        optimisticStarred={optimisticStarred}
        onToggleStar={handleToggleStar}
        onShare={handleShare}
        onArchive={() => setArchiveDialogOpen(true)}
      />

      <div className="flex gap-0">
        <article className="max-w-3xl min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
          <h1 className="mb-4 text-3xl font-bold text-content-primary">{title}</h1>

          {/* Mobile "Contents" button */}
          {(tocItems.length > 0 ||
            (sources && sources.length > 0) ||
            (attachments && attachments.length > 0)) && (
            <button
              ref={mobileContentsTriggerRef}
              type="button"
              onClick={openMobileContents}
              className="mb-4 flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-sm text-content-secondary md:hidden"
            >
              <List size={14} />
              {t("wiki.contents")}
            </button>
          )}
          {tags.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <TagChip
                  key={tag.tagSlug}
                  tagSlug={tag.tagSlug}
                  labelJa={tag.labelJa}
                  labelEn={tag.labelEn}
                  color={tag.color}
                  size="md"
                />
              ))}
            </div>
          )}

          {hasFallback && (
            <div className="mb-6 rounded-lg border border-feedback-warning-border bg-feedback-warning-surface p-4 text-sm text-feedback-warning-foreground">
              {lang === "en"
                ? t("wiki.translation_fallback_en")
                : t("wiki.translation_fallback_ja")}
            </div>
          )}

          {displayContent ? (
            <MdPreview
              modelValue={displayContent}
              theme={theme}
              autoFoldThreshold={Number.POSITIVE_INFINITY}
              onGetCatalog={handleGetCatalog}
            />
          ) : (
            <p className="text-content-disabled">No content available.</p>
          )}
        </article>

        {/* Right sidebar — hidden on mobile */}
        {isDesktop && (
          <WikiRightSidebar
            tocItems={tocItems}
            author={author}
            editor={editor}
            updatedAt={page.updatedAt}
            lang={lang}
            pageId={page.id}
            isAdmin={isAdmin}
            translationStatusJa={page.translationStatusJa}
            translationStatusEn={page.translationStatusEn}
            sources={sources}
            attachments={attachments}
          />
        )}
      </div>

      {/* Comments section — full article width below content */}
      <div className="max-w-3xl min-w-0 flex-1 border-t border-border-subtle px-4 py-8 md:px-10">
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Await resolve={comments}>
            {(resolvedComments) => (
              <CommentSection
                comments={resolvedComments}
                pageId={page.id}
                pageSlug={page.slug}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                canComment={canComment}
              />
            )}
          </Await>
        </Suspense>
      </div>

      <ConfirmDialog
        open={archiveDialogOpen}
        title={t("wiki.archive")}
        message={t("wiki.archive_confirm", { title })}
        confirmLabel={t("wiki.archive")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          archiveFetcher.submit({ intent: "archivePage" }, { method: "post" });
          setArchiveDialogOpen(false);
        }}
        onCancel={() => setArchiveDialogOpen(false)}
      />

      {isAuthenticated && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          pageId={page.id}
          pageTitle={title}
          currentVisibility={visibility}
          canManageAccess={canManageAccess}
          canChangeVisibility={canChangeVisibility}
        />
      )}

      {/* Mobile contents bottom sheet */}
      {mobileContentsOpen && (
        <MobileContentsSheet
          page={page}
          tocItems={tocItems}
          tags={tags}
          editor={editor}
          lang={lang}
          sources={sources}
          attachments={attachments}
          onClose={closeMobileContents}
        />
      )}
    </div>
  );
}
