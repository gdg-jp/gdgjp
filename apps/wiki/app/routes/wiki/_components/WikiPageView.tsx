import { Badge, Breadcrumb } from "@gdgjp/design-system";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Await,
  Link,
  useFetcher,
  useLoaderData,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import ConfirmDialog from "~/components/ConfirmDialog";
import { ArticleSkeleton, ListSkeleton, TocSkeleton } from "~/components/Skeleton";
import { AskAgentDialog } from "~/features/pages/components/AskAgentDialog";
import CommentSection from "~/features/pages/components/CommentSection";
import ShareDialog from "~/features/pages/components/ShareDialog";
import { usePageDisplay } from "~/features/pages/use-page-display";
import type { loader } from "../page";
import { WikiPageBody } from "./WikiPageBody";
import { WikiPageToolbar } from "./WikiPageToolbar";

export function WikiPageView() {
  const {
    space,
    page,
    ancestors,
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
    canAskAgent,
    canManageAccess,
    canChangeVisibility,
    visibility,
  } = useLoaderData<typeof loader>();
  const [display, setDisplay] = usePageDisplay(page.id, currentUserId);
  const shell = useRouteLoaderData("routes/_app") as { hideAgentPages?: boolean } | undefined;
  const isAgentPage = page.origin === "agent";
  const { t } = useTranslation("common");
  const location = useLocation();
  const contentLangFetcher = useFetcher();
  const submitRef = contentLangFetcher.submit;

  // Persist content lang selection only when it differs from the stored value.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("content_lang");
      if (stored === lang) return;
      localStorage.setItem("content_lang", lang);
    } catch {
      // Reader preferences must remain usable when browser storage is blocked.
    }
    submitRef({ lang }, { method: "post", action: "/api/set-content-lang" });
  }, [lang, submitRef]);

  const title = lang === "en" ? page.titleEn || page.titleJa : page.titleJa || page.titleEn;

  const archiveFetcher = useFetcher();
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const jaUrl = `${location.pathname}?lang=ja`;
  const enUrl = `${location.pathname}?lang=en`;

  return (
    <div>
      <WikiPageToolbar
        key={`${currentUserId}:${page.id}:${location.pathname}`}
        title={title}
        content={content}
        display={display}
        onDisplayChange={setDisplay}
        page={page}
        lang={lang}
        jaUrl={jaUrl}
        enUrl={enUrl}
        canEdit={canEdit}
        onAskAgent={canAskAgent ? () => setAskOpen(true) : undefined}
        isAuthenticated={isAuthenticated}
        canArchive={canArchive}
        pageMeta={pageMeta}
        onShare={() => setShareOpen(true)}
        onArchive={() => setArchiveDialogOpen(true)}
      />

      <div className="px-4 pt-6 md:px-10 md:pt-8">
        {isAgentPage && shell?.hideAgentPages && (
          <p role="note" className="mb-3 text-sm text-muted">
            {t("spaces.agent_hidden_banner")}
          </p>
        )}
        <Breadcrumb aria-label={t("wiki.breadcrumb")} className="mb-3 text-sm text-muted">
          <li>
            <Link to={`/s/${encodeURIComponent(space.slug)}`} className="hover:text-foreground">
              {space.name}
            </Link>
          </li>
          {ancestors.map((ancestor) => (
            <li key={ancestor.slug}>
              <Link to={ancestor.path} className="hover:text-foreground">
                {lang === "en"
                  ? ancestor.titleEn || ancestor.titleJa
                  : ancestor.titleJa || ancestor.titleEn}
              </Link>
            </li>
          ))}
          <li aria-current="page" className="truncate text-foreground">
            {title}
          </li>
        </Breadcrumb>
        <Badge tone={isAgentPage ? "info" : "neutral"} className="mb-2">
          {t(isAgentPage ? "pages.origin_agent" : "pages.origin_human")}
        </Badge>
        <h1
          className={`${display.fullWidth ? "" : "max-w-3xl"} text-3xl font-bold text-foreground`}
        >
          {title}
        </h1>
      </div>

      <Suspense
        fallback={
          <div className="flex gap-0">
            <div
              className={`${display.fullWidth ? "" : "max-w-3xl"} min-w-0 flex-1 px-4 pt-4 pb-6 md:px-10 md:pt-4 md:pb-8`}
            >
              <ArticleSkeleton />
            </div>
            <TocSkeleton />
          </div>
        }
      >
        <Await
          resolve={content}
          errorElement={
            <div className="px-4 py-6 md:px-10 md:py-8 text-sm text-danger">
              Failed to load page content.
            </div>
          }
        >
          {(resolvedContent) => (
            <WikiPageBody
              display={display}
              page={page}
              title={title}
              content={resolvedContent}
              pageMeta={pageMeta}
              lang={lang}
              isAdmin={isAdmin}
            />
          )}
        </Await>
      </Suspense>

      {/* Comments section — full article width below content */}
      <div
        className={`${display.fullWidth ? "" : "max-w-3xl"} min-w-0 flex-1 border-t border-border px-4 py-8 md:px-10`}
      >
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <Await
            resolve={comments}
            errorElement={<p className="text-sm text-muted">Failed to load comments.</p>}
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
      <AskAgentDialog open={askOpen} onOpenChange={setAskOpen} />
    </div>
  );
}
