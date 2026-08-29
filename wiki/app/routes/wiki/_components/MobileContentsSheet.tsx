import { ExternalLink, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import TagChip from "~/features/pages/components/TagChip";
import type { TocItem } from "~/features/pages/components/WikiRightSidebar";
import { timeAgo } from "~/lib/time";

type WikiPageSlice = {
  updatedAt: Date | string | number | null;
  translationStatusJa: string;
  translationStatusEn: string;
};
type Tag = { tagSlug: string; labelJa: string; labelEn: string; color: string };
type Source = { url: string; title: string };
type Attachment = { r2Key: string; fileName: string; mimeType: string };

/** Bottom-sheet table of contents / metadata for `/wiki/*` on mobile. */
export function MobileContentsSheet({
  page,
  tocItems,
  tags,
  editor,
  lang,
  sources,
  attachments,
  onClose,
}: {
  page: WikiPageSlice;
  tocItems: TocItem[];
  tags: Tag[];
  editor: { name: string } | null;
  lang: "ja" | "en";
  sources: Source[];
  attachments: Attachment[];
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const firstFocusable = sheet.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? sheet).focus();
  }, []);

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes via pointer; Escape handled by window keydown */}
      <div
        className="fixed inset-0 top-14 z-40 bg-content-primary/40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl bg-surface-raised shadow-xl md:hidden"
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <p className="font-semibold text-content-primary">{t("wiki.contents")}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-content-disabled hover:bg-surface-hover hover:text-content-secondary"
            aria-label={t("common:close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-4 py-3">
          {/* TOC */}
          {tocItems.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-disabled">
                {t("wiki.on_this_page")}
              </p>
              <nav aria-label={t("tableOfContents")}>
                <ul className="space-y-1">
                  {tocItems.map((item) => (
                    <li
                      key={item.id}
                      style={{ paddingLeft: item.level === 3 ? "0.75rem" : undefined }}
                    >
                      <a
                        href={`#${item.id}`}
                        onClick={onClose}
                        className="block truncate py-1 text-sm text-content-secondary hover:text-content-primary"
                      >
                        {item.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-disabled">
                {t("wiki.tags")}
              </p>
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <TagChip
                    key={tag.tagSlug}
                    tagSlug={tag.tagSlug}
                    labelJa={tag.labelJa}
                    labelEn={tag.labelEn}
                    color={tag.color}
                    size="md"
                    onClick={onClose}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Last edited */}
          {page.updatedAt && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-disabled">
                {t("wiki.last_edited_by")}
              </p>
              <p className="text-xs text-content-tertiary">
                {editor ? `${editor.name}, ` : ""}
                {timeAgo(new Date(page.updatedAt as unknown as string), t)}
              </p>
            </div>
          )}

          {/* Translation status */}
          {(lang === "en" ? page.translationStatusEn : page.translationStatusJa) === "ai" && (
            <span className="inline-flex items-center rounded-full bg-feedback-warning-surface px-2 py-0.5 text-xs font-medium text-feedback-warning-foreground">
              {t("wiki.auto_translated")}
            </span>
          )}

          {/* Sources (URLs, PDFs, and image attachments) */}
          {((sources && sources.length > 0) || (attachments && attachments.length > 0)) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-disabled">
                {t("wiki.sources")}
              </p>
              {sources && sources.length > 0 && (
                <ul className="space-y-1.5">
                  {sources.map(({ url, title: sourceTitle }) => {
                    const isDoc = url.includes("docs.google.com/document");
                    const isSlide = url.includes("docs.google.com/presentation");
                    const isPdf = url.startsWith("/api/images/");
                    return (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-action-primary hover:underline"
                        >
                          {isDoc && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              className="flex-shrink-0"
                              aria-hidden="true"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
                                fill="var(--color-brand-google-blue)"
                              />
                              <path d="M14 2v6h6" fill="var(--color-brand-google-blue-soft)" />
                              <path
                                d="M8 13h8M8 17h5"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                          )}
                          {isSlide && (
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              className="flex-shrink-0"
                              aria-hidden="true"
                            >
                              <rect
                                width="24"
                                height="24"
                                rx="2"
                                fill="var(--color-brand-google-yellow)"
                              />
                              <rect x="4" y="6" width="16" height="12" rx="1" fill="white" />
                              <polygon
                                points="10,9 10,15 16,12"
                                fill="var(--color-brand-google-yellow)"
                              />
                            </svg>
                          )}
                          {isPdf && <FileText className="h-3 w-3 flex-shrink-0" />}
                          {!isDoc && !isSlide && !isPdf && (
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          )}
                          <span className="truncate">{sourceTitle}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
              {attachments && attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {attachments.map(({ r2Key, fileName }) => (
                    <a
                      key={r2Key}
                      href={`/api/images/${r2Key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={fileName}
                    >
                      <img
                        src={`/api/images/${r2Key}`}
                        alt={fileName}
                        className="h-12 w-12 rounded border border-border-default object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
