import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Await, useFetcher, useLoaderData, useLocation } from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { ArticleSkeleton, ListSkeleton, TocSkeleton } from "~/components/Skeleton";
import CommentSection from "~/features/pages/components/CommentSection";
import ShareDialog from "~/features/pages/components/ShareDialog";
import type { loader } from "../page";
import { WikiPageBody } from "./WikiPageBody";
import { WikiPageToolbar } from "./WikiPageToolbar";

export function WikiPageView() {
  const {
    page,
    content,
    pageMeta,
    comments,
    lang,
    isAdmin,
    canArchive,
    currentUserId,
    isAuthenticated,
    canComment,
    canEdit,
    canManageAccess,
    canChangeVisibility,
    visibility,
  } = useLoaderData<typeof loader>();
  const { t } = useTranslation("common");
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

  const title = lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  const archiveFetcher = useFetcher();
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

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
        pageMeta={pageMeta}
        onShare={() => setShareOpen(true)}
        onArchive={() => setArchiveDialogOpen(true)}
      />

      <div className="px-4 pt-6 md:px-10 md:pt-8">
        <h1 className="max-w-3xl text-3xl font-bold text-content-primary">{title}</h1>
      </div>

      <Suspense
        fallback={
          <div className="flex gap-0">
            <div className="max-w-3xl min-w-0 flex-1 px-4 pt-4 pb-6 md:px-10 md:pt-4 md:pb-8">
              <ArticleSkeleton />
            </div>
            <TocSkeleton />
          </div>
        }
      >
        <Await
          resolve={content}
          errorElement={
            <div className="px-4 py-6 md:px-10 md:py-8 text-sm text-feedback-danger-foreground">
              Failed to load page content.
            </div>
          }
        >
          {(resolvedContent) => (
            <WikiPageBody
              page={page}
              content={resolvedContent}
              pageMeta={pageMeta}
              lang={lang}
              isAdmin={isAdmin}
            />
          )}
        </Await>
      </Suspense>

      {/* Comments section — full article width below content */}
      <div className="max-w-3xl min-w-0 flex-1 border-t border-border-subtle px-4 py-8 md:px-10">
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Await
            resolve={comments}
            errorElement={<p className="text-sm text-content-tertiary">Failed to load comments.</p>}
          >
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
    </div>
  );
}
