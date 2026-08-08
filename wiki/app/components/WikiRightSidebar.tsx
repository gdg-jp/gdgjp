import { ExternalLink, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { timeAgo } from "~/lib/time";

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface Editor {
  id: string;
  name: string;
}

interface WikiRightSidebarProps {
  tocItems: TocItem[];
  editor: Editor | null;
  updatedAt: Date | string | number | null;
  lang: "ja" | "en";
  translationStatusJa: string;
  translationStatusEn: string;
  sources?: { url: string; title: string }[];
  attachments?: { r2Key: string; fileName: string; mimeType: string }[];
}

export default function WikiRightSidebar({
  tocItems,
  editor,
  updatedAt,
  lang,
  translationStatusJa,
  translationStatusEn,
  sources,
  attachments,
}: WikiRightSidebarProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { t } = useTranslation();
  const translationStatus = lang === "en" ? translationStatusEn : translationStatusJa;

  useEffect(() => {
    if (!tocItems.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "0% 0% -80% 0%", threshold: 0 },
    );
    for (const item of tocItems) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [tocItems]);

  return (
    <aside className="sticky top-14 w-56 flex-shrink-0 self-start overflow-y-auto px-4 py-8">
      {/* Table of Contents */}
      {tocItems.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
            {t("wiki.on_this_page")}
          </p>
          <nav aria-label="Table of contents">
            <ul className="space-y-1">
              {tocItems.map((item) => (
                <li key={item.id} style={{ paddingLeft: item.level === 3 ? "0.75rem" : undefined }}>
                  <a
                    href={`#${item.id}`}
                    className={[
                      "block truncate text-sm transition-colors",
                      activeId === item.id
                        ? "font-medium text-action-primary"
                        : "text-content-secondary hover:text-content-primary",
                    ].join(" ")}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-4">
        {/* Last edited */}
        {updatedAt && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
              {t("wiki.last_edited_by")}
            </p>
            <p className="text-xs text-content-secondary">
              {editor ? `${editor.name}, ` : ""}
              {timeAgo(new Date(updatedAt as string), t)}
            </p>
          </div>
        )}

        {/* Translation status */}
        {translationStatus === "ai" && (
          <span className="inline-flex items-center rounded-full bg-feedback-warning-surface px-2 py-0.5 text-xs font-medium text-feedback-warning-foreground">
            {t("wiki.auto_translated")}
          </span>
        )}

        {/* Sources (URLs, PDFs, and image attachments) */}
        {((sources && sources.length > 0) || (attachments && attachments.length > 0)) && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
              {t("wiki.sources")}
            </p>
            {sources && sources.length > 0 && (
              <ul className="space-y-1.5">
                {sources.map(({ url, title }) => {
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
                        <span className="truncate">{title}</span>
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
                      className="h-12 w-12 rounded border border-default object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
