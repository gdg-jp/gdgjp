import { List } from "lucide-react";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/preview.css";
import { Suspense, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await } from "react-router";
import { MetaBarSkeleton, TocSkeleton } from "~/components/Skeleton";
import { parseMdHeadings } from "~/features/editor/toc";
import TagChip from "~/features/pages/components/TagChip";
import type { TocItem } from "~/features/pages/components/WikiRightSidebar";
import WikiRightSidebar from "~/features/pages/components/WikiRightSidebar";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useThemeMode } from "~/hooks/useThemeMode";
import { MobileContentsSheet } from "./MobileContentsSheet";

type PageSlice = {
  id: string;
  slug: string;
  translationStatusJa: string;
  translationStatusEn: string;
  updatedAt: Date | string | number | null;
};

type Tag = { tagSlug: string; labelJa: string; labelEn: string; color: string };
type Author = { id: string; name: string; image: string | null };
type Editor = { id: string; name: string };
type Source = { url: string; title: string };
type Attachment = { r2Key: string; fileName: string; mimeType: string };

export type PageMetaPayload = {
  tags: Tag[];
  author: Author | null;
  editor: Editor | null;
  isStarred: boolean;
  sources: Source[];
  attachments: Attachment[];
};

interface WikiPageBodyProps {
  page: PageSlice;
  content: { contentJa: string; contentEn: string };
  pageMeta: Promise<PageMetaPayload>;
  lang: "ja" | "en";
  isAdmin: boolean;
}

export function WikiPageBody({ page, content, pageMeta, lang, isAdmin }: WikiPageBodyProps) {
  const { t } = useTranslation("common");
  const theme = useThemeMode();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const primaryContent = lang === "en" ? content.contentEn : content.contentJa;
  const fallbackContent = lang === "en" ? content.contentJa : content.contentEn;

  const hasContent = primaryContent && primaryContent.trim().length > 0;
  const hasFallback = !hasContent && fallbackContent && fallbackContent.trim().length > 0;
  const displayContent = hasContent ? primaryContent : (fallbackContent ?? "");

  const [tocItems, setTocItems] = useState<TocItem[]>(() => parseMdHeadings(displayContent));
  const [mobileContentsOpen, setMobileContentsOpen] = useState(false);
  const mobileContentsTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  const handleGetCatalog = useCallback((list: Array<{ text: string; level: number }>) => {
    setTocItems((prev) => {
      const next = list
        .filter((h) => h.level === 2 || h.level === 3)
        .map((h) => ({ id: h.text, text: h.text, level: h.level }));
      if (
        prev.length === next.length &&
        prev.every((item, i) => item.id === next[i].id && item.level === next[i].level)
      ) {
        return prev;
      }
      return next;
    });
  }, []);

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

  return (
    <div className="flex gap-0">
      <article className="max-w-3xl min-w-0 flex-1 px-4 pt-4 pb-6 md:px-10 md:pt-4 md:pb-8">
        {/* Mobile "Contents" button */}
        {tocItems.length > 0 ? (
          <button
            ref={mobileContentsTriggerRef}
            type="button"
            onClick={openMobileContents}
            className="mb-4 flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-sm text-content-secondary md:hidden"
          >
            <List size={14} />
            {t("wiki.contents")}
          </button>
        ) : (
          <Suspense fallback={null}>
            <Await resolve={pageMeta} errorElement={null}>
              {(meta) => {
                const hasMetaContents = Boolean(
                  (meta?.sources && meta.sources.length > 0) ||
                    (meta?.attachments && meta.attachments.length > 0),
                );
                if (!hasMetaContents) return null;
                return (
                  <button
                    ref={mobileContentsTriggerRef}
                    type="button"
                    onClick={openMobileContents}
                    className="mb-4 flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-sm text-content-secondary md:hidden"
                  >
                    <List size={14} />
                    {t("wiki.contents")}
                  </button>
                );
              }}
            </Await>
          </Suspense>
        )}

        <Suspense fallback={<MetaBarSkeleton />}>
          <Await resolve={pageMeta} errorElement={null}>
            {(meta) =>
              meta && meta.tags.length > 0 ? (
                <div className="mb-6 flex flex-wrap gap-2">
                  {meta.tags.map((tag) => (
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
              ) : null
            }
          </Await>
        </Suspense>

        {hasFallback && (
          <div className="mb-6 rounded-lg border border-feedback-warning-border bg-feedback-warning-surface p-4 text-sm text-feedback-warning-foreground">
            {lang === "en" ? t("wiki.translation_fallback_en") : t("wiki.translation_fallback_ja")}
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
        <Suspense fallback={<TocSkeleton />}>
          <Await
            resolve={pageMeta}
            errorElement={
              <WikiRightSidebar
                tocItems={tocItems}
                author={null}
                editor={null}
                updatedAt={page.updatedAt}
                lang={lang}
                pageId={page.id}
                isAdmin={isAdmin}
                translationStatusJa={page.translationStatusJa}
                translationStatusEn={page.translationStatusEn}
              />
            }
          >
            {(meta) => (
              <WikiRightSidebar
                tocItems={tocItems}
                author={meta?.author ?? null}
                editor={meta?.editor ?? null}
                updatedAt={page.updatedAt}
                lang={lang}
                pageId={page.id}
                isAdmin={isAdmin}
                translationStatusJa={page.translationStatusJa}
                translationStatusEn={page.translationStatusEn}
                sources={meta?.sources}
                attachments={meta?.attachments}
              />
            )}
          </Await>
        </Suspense>
      )}

      {/* Mobile contents bottom sheet */}
      {mobileContentsOpen && (
        <Suspense fallback={null}>
          <Await resolve={pageMeta} errorElement={null}>
            {(meta) => (
              <MobileContentsSheet
                page={page}
                tocItems={tocItems}
                tags={meta?.tags ?? []}
                editor={meta?.editor ?? null}
                lang={lang}
                sources={meta?.sources ?? []}
                attachments={meta?.attachments ?? []}
                onClose={closeMobileContents}
              />
            )}
          </Await>
        </Suspense>
      )}
    </div>
  );
}
