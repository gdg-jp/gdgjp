import { and, asc, eq, inArray } from "drizzle-orm";
import { MdPreview } from "md-editor-rt";
import "md-editor-rt/lib/preview.css";
import {
  Archive,
  ExternalLink,
  FileText,
  History,
  List,
  MoreHorizontal,
  Pencil,
  Share2,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, redirect, useFetcher, useLoaderData, useLocation } from "react-router";
import CommentSection from "~/components/CommentSection";
import ConfirmDialog from "~/components/ConfirmDialog";
import ShareDialog from "~/components/ShareDialog";
import TagChip from "~/components/TagChip";
import Tooltip from "~/components/Tooltip";
import type { TocItem } from "~/components/WikiRightSidebar";
import WikiRightSidebar from "~/components/WikiRightSidebar";
import * as schema from "~/db/schema";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useThemeMode } from "~/hooks/useThemeMode";
import { getAccessIdentity, requireUser } from "~/lib/auth-utils.server";
import { getDb } from "~/lib/db.server";
import { deletePageEmbeddings } from "~/lib/embedding-pipeline.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";
import { timeAgo } from "~/lib/time";
import { tiptapToMarkdown } from "~/lib/tiptap-convert";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  return [
    {
      title: data ? `${data.page.titleEn || data.page.titleJa} — GDG Japan Wiki` : "Page not found",
    },
    ...(data?.page.visibility !== "public"
      ? [{ name: "robots", content: "noindex,nofollow" }]
      : []),
  ];
};

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const sessionUser = identity.user;
  const db = getDb(env);

  const page = await db
    .select({
      id: schema.pages.id,
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      slug: schema.pages.slug,
      status: schema.pages.status,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
      translationStatusJa: schema.pages.translationStatusJa,
      translationStatusEn: schema.pages.translationStatusEn,
      summaryJa: schema.pages.summaryJa,
      summaryEn: schema.pages.summaryEn,
      pageType: schema.pages.pageType,
      visibility: schema.pages.visibility,
      generalRole: schema.pages.generalRole,
      chapterId: schema.pages.chapterId,
      authorId: schema.pages.authorId,
      lastEditedBy: schema.pages.lastEditedBy,
      updatedAt: schema.pages.updatedAt,
    })
    .from(schema.pages)
    .where(eq(schema.pages.slug, params.slug ?? ""))
    .get();

  if (!page || page.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  const permissions = await getEffectivePagePermissions(db, page, sessionUser, identity.chapterIds);
  if (!permissions.canView) {
    if (!identity.claimsAvailable && page.visibility === "restricted") {
      throw new Response("Access service temporarily unavailable", { status: 503 });
    }
    throw new Response("Not Found", { status: 404 });
  }

  const [pageTags, authorRow, editorRow, fav, sources, attachments] = await Promise.all([
    db
      .select({
        tagSlug: schema.pageTags.tagSlug,
        labelJa: schema.tags.labelJa,
        labelEn: schema.tags.labelEn,
        color: schema.tags.color,
      })
      .from(schema.pageTags)
      .innerJoin(schema.tags, eq(schema.pageTags.tagSlug, schema.tags.slug))
      .where(eq(schema.pageTags.pageId, page.id))
      .all(),
    db
      .select({ id: schema.user.id, name: schema.user.name, image: schema.user.image })
      .from(schema.user)
      .where(eq(schema.user.id, page.authorId))
      .get(),
    db
      .select({ id: schema.user.id, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, page.lastEditedBy))
      .get(),
    sessionUser
      ? db
          .select()
          .from(schema.pageFavorites)
          .where(
            and(
              eq(schema.pageFavorites.userId, sessionUser.id),
              eq(schema.pageFavorites.pageId, page.id),
            ),
          )
          .get()
      : Promise.resolve(undefined),
    db
      .select({ url: schema.pageSources.url, title: schema.pageSources.title })
      .from(schema.pageSources)
      .where(eq(schema.pageSources.pageId, page.id))
      .all(),
    db
      .select({
        r2Key: schema.pageAttachments.r2Key,
        fileName: schema.pageAttachments.fileName,
        mimeType: schema.pageAttachments.mimeType,
      })
      .from(schema.pageAttachments)
      .where(eq(schema.pageAttachments.pageId, page.id))
      .all(),
  ]);

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const lang: "ja" | "en" = langParam === "ja" || langParam === "en" ? langParam : "ja";

  // Fetch comments + reactions
  const commentsRaw = await db
    .select({
      id: schema.pageComments.id,
      authorId: schema.pageComments.authorId,
      authorName: schema.user.name,
      authorImage: schema.user.image,
      parentId: schema.pageComments.parentId,
      contentJson: schema.pageComments.contentJson,
      deletedAt: schema.pageComments.deletedAt,
      createdAt: schema.pageComments.createdAt,
    })
    .from(schema.pageComments)
    .innerJoin(schema.user, eq(schema.pageComments.authorId, schema.user.id))
    .where(eq(schema.pageComments.pageId, page.id))
    .orderBy(asc(schema.pageComments.createdAt))
    .all();

  const commentIds = commentsRaw.map((c) => c.id);
  const reactionsRaw =
    commentIds.length > 0
      ? await db
          .select()
          .from(schema.commentReactions)
          .where(inArray(schema.commentReactions.commentId, commentIds))
          .orderBy(asc(schema.commentReactions.createdAt))
          .all()
      : [];

  // Build reaction groups per comment
  const reactionsByComment = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean }[]
  >();
  for (const r of reactionsRaw) {
    const list = reactionsByComment.get(r.commentId) ?? [];
    const existing = list.find((x) => x.emoji === r.emoji);
    if (existing) {
      existing.count++;
      if (r.userId === sessionUser?.id) existing.reactedByMe = true;
    } else {
      list.push({ emoji: r.emoji, count: 1, reactedByMe: r.userId === sessionUser?.id });
    }
    reactionsByComment.set(r.commentId, list);
  }

  // Build flat list with reactions, then nest replies under top-level
  type ReactionGroup = { emoji: string; count: number; reactedByMe: boolean };
  type FlatComment = (typeof commentsRaw)[number] & {
    reactions: ReactionGroup[];
    replies: FlatComment[];
  };
  const flatComments: FlatComment[] = commentsRaw.map((c) => ({
    ...c,
    reactions: reactionsByComment.get(c.id) ?? [],
    replies: [],
  }));
  const commentMap = new Map<string, FlatComment>(flatComments.map((c) => [c.id, c]));
  const topLevelComments: FlatComment[] = [];
  for (const c of flatComments) {
    if (c.parentId) {
      commentMap.get(c.parentId)?.replies.push(c);
    } else {
      topLevelComments.push(c);
    }
  }

  // Fire-and-forget view tracking
  if (sessionUser) {
    context.cloudflare.ctx.waitUntil(
      db
        .insert(schema.pageViews)
        .values({ userId: sessionUser.id, pageId: page.id, viewedAt: new Date() })
        .onConflictDoUpdate({
          target: [schema.pageViews.userId, schema.pageViews.pageId],
          set: { viewedAt: new Date() },
        })
        .run(),
    );
  }

  return {
    page: {
      ...page,
      contentJa: tiptapToMarkdown(page.contentJa ?? ""),
      contentEn: tiptapToMarkdown(page.contentEn ?? ""),
    },
    tags: pageTags,
    author: authorRow ?? null,
    editor: editorRow ?? null,
    lang,
    isAdmin: sessionUser?.isAdmin ?? false,
    isAuthor: sessionUser?.id === page.authorId,
    canArchive: !!sessionUser && (sessionUser.id === page.authorId || sessionUser.isAdmin),
    currentUserId: sessionUser?.id ?? null,
    isAuthenticated: !!sessionUser,
    canComment: permissions.canComment,
    canEdit: permissions.canEdit,
    visibility: page.visibility,
    canChangeVisibility: permissions.canManageSharing,
    canManageAccess: permissions.canManageSharing,
    isStarred: !!fav,
    sources,
    attachments,
    comments: topLevelComments,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "toggleFavorite") {
    const pageId = form.get("pageId");
    if (typeof pageId !== "string" || !pageId) {
      return new Response("Missing pageId", { status: 400 });
    }

    const existing = await db
      .select()
      .from(schema.pageFavorites)
      .where(
        and(
          eq(schema.pageFavorites.userId, sessionUser.id),
          eq(schema.pageFavorites.pageId, pageId),
        ),
      )
      .get();

    if (existing) {
      await db
        .delete(schema.pageFavorites)
        .where(
          and(
            eq(schema.pageFavorites.userId, sessionUser.id),
            eq(schema.pageFavorites.pageId, pageId),
          ),
        );
      return { ok: true, starred: false };
    }
    await db.insert(schema.pageFavorites).values({ userId: sessionUser.id, pageId });
    return { ok: true, starred: true };
  }

  if (intent === "archivePage") {
    const page = await db
      .select({ id: schema.pages.id, authorId: schema.pages.authorId })
      .from(schema.pages)
      .where(eq(schema.pages.slug, params.slug ?? ""))
      .get();
    if (!page) throw new Response("Not Found", { status: 404 });
    const isAuthor = sessionUser.id === page.authorId;
    if (!isAuthor && !sessionUser.isAdmin) throw new Response("Forbidden", { status: 403 });
    await db
      .update(schema.pages)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    try {
      await deletePageEmbeddings(env, db, page.id);
    } catch {
      // best-effort cleanup
    }
    return redirect("/");
  }

  return new Response("Unknown intent", { status: 400 });
}

// ---------------------------------------------------------------------------
// Heading parser for initial SSR TOC
// ---------------------------------------------------------------------------

function parseMdHeadings(md: string): TocItem[] {
  const lines = md.split("\n");
  return lines.flatMap((line) => {
    const m = line.match(/^(#{1,6}) (.+)/);
    if (!m) return [];
    const level = m[1].length;
    if (level !== 2 && level !== 3) return [];
    const text = m[2].trim();
    return [{ id: text, text, level }];
  });
}

export default function WikiPage() {
  const {
    page,
    tags,
    author,
    editor,
    lang,
    isAdmin,
    isAuthor,
    canArchive,
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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [mobileContentsOpen, setMobileContentsOpen] = useState(false);
  const mobileContentsTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileContentsSheetRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!mobileContentsOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileContents();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileContentsOpen, closeMobileContents]);

  useEffect(() => {
    if (!mobileContentsOpen) return;

    const sheet = mobileContentsSheetRef.current;
    if (!sheet) return;

    const firstFocusable = sheet.querySelector<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? sheet).focus();
  }, [mobileContentsOpen]);

  // Optimistic star state for the action bar toggle
  const optimisticStarred = favFetcher.state !== "idle" ? !currentStarred : currentStarred;

  function handleToggleStar() {
    favFetcher.submit({ intent: "toggleFavorite", pageId: page.id }, { method: "post" });
  }

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  function handleShare() {
    setShareOpen(true);
  }

  const jaUrl = `${location.pathname}?lang=ja`;
  const enUrl = `${location.pathname}?lang=en`;

  const btnBase =
    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700";

  return (
    <div>
      {/* Mini-header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 md:px-10">
        <div className="flex shrink-0 gap-1 rounded-md border border-gray-200 bg-white p-0.5">
          {(["ja", "en"] as const).map((l) => {
            const status = l === "ja" ? page.translationStatusJa : page.translationStatusEn;
            const isPending = status === "missing";
            const isActive = lang === l;
            const className = [
              "min-w-10 rounded px-2 py-1 text-center text-sm font-medium transition-colors",
              isActive
                ? "bg-blue-500 text-white"
                : isPending
                  ? "text-gray-300"
                  : "text-gray-600 hover:bg-gray-100",
            ].join(" ");

            if (isPending) {
              return (
                <span
                  key={l}
                  aria-disabled="true"
                  title={t("wiki.translation_pending")}
                  className={className}
                >
                  {l === "ja" ? "JA" : "EN"}
                </span>
              );
            }

            return (
              <Link key={l} to={l === "ja" ? jaUrl : enUrl} className={className}>
                {l === "ja" ? "JA" : "EN"}
              </Link>
            );
          })}
        </div>
        {/* Desktop action buttons (md+) */}
        <div className="hidden items-center gap-1 md:flex">
          {canEdit && (
            <Link to={`/wiki/${page.slug}/edit`} className={btnBase}>
              <Pencil size={14} />
              {t("wiki.edit")}
            </Link>
          )}
          <Link to={`/wiki/${page.slug}/history`} className={btnBase}>
            <History size={14} />
            {t("wiki.history")}
          </Link>
          {isAuthenticated && (
            <>
              <button
                type="button"
                onClick={handleToggleStar}
                className={btnBase}
                style={optimisticStarred ? { color: "#E06C00" } : undefined}
              >
                <Star
                  size={14}
                  style={optimisticStarred ? { fill: "#E06C00", color: "#E06C00" } : undefined}
                />
                {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
              </button>
              <button type="button" onClick={handleShare} className={btnBase}>
                <Share2 size={14} />
                {t("wiki.share")}
              </button>
            </>
          )}
          <Tooltip label={t("wiki.archive_no_permission")} disabled={!canArchive}>
            <button
              type="button"
              onClick={canArchive ? () => setArchiveDialogOpen(true) : undefined}
              disabled={!canArchive}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
            >
              <Archive size={14} />
              {t("wiki.archive")}
            </button>
          </Tooltip>
        </div>

        {/* Mobile "more" dropdown (<md) */}
        <div ref={moreRef} className="relative md:hidden">
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={btnBase}
            aria-label="More actions"
          >
            <MoreHorizontal size={16} />
          </button>
          {moreOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
              {canEdit && (
                <Link
                  to={`/wiki/${page.slug}/edit`}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  onClick={() => setMoreOpen(false)}
                >
                  <Pencil size={14} />
                  {t("wiki.edit")}
                </Link>
              )}
              <Link
                to={`/wiki/${page.slug}/history`}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                onClick={() => setMoreOpen(false)}
              >
                <History size={14} />
                {t("wiki.history")}
              </Link>
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => {
                    handleToggleStar();
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                  style={optimisticStarred ? { color: "#E06C00" } : undefined}
                >
                  <Star
                    size={14}
                    style={optimisticStarred ? { fill: "#E06C00", color: "#E06C00" } : undefined}
                  />
                  {optimisticStarred ? t("wiki.unstar") : t("wiki.starred")}
                </button>
              )}
              {isAuthenticated && (
                <button
                  type="button"
                  onClick={() => {
                    handleShare();
                    setMoreOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                >
                  <Share2 size={14} />
                  {t("wiki.share")}
                </button>
              )}
              <Tooltip label={t("wiki.archive_no_permission")} disabled={!canArchive}>
                <button
                  type="button"
                  onClick={
                    canArchive
                      ? () => {
                          setArchiveDialogOpen(true);
                          setMoreOpen(false);
                        }
                      : undefined
                  }
                  disabled={!canArchive}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50"
                >
                  <Archive size={14} />
                  {t("wiki.archive")}
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-0">
        <article className="max-w-3xl min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
          <h1 className="mb-4 text-3xl font-bold text-gray-900">{title}</h1>

          {/* Mobile "Contents" button */}
          {(tocItems.length > 0 ||
            author ||
            (sources && sources.length > 0) ||
            (attachments && attachments.length > 0)) && (
            <button
              ref={mobileContentsTriggerRef}
              type="button"
              onClick={openMobileContents}
              className="mb-4 flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-600 md:hidden"
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
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
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
            <p className="text-gray-400">No content available.</p>
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
            translationStatusJa={page.translationStatusJa}
            translationStatusEn={page.translationStatusEn}
            sources={sources}
            attachments={attachments}
          />
        )}
      </div>

      {/* Comments section — full article width below content */}
      <div className="max-w-3xl min-w-0 flex-1 border-t border-gray-100 px-4 py-8 md:px-10">
        <CommentSection
          comments={comments}
          pageId={page.id}
          pageSlug={page.slug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          canComment={canComment}
        />
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
        <>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes via pointer; Escape handled by window keydown */}
          <div
            className="fixed inset-0 top-14 z-40 bg-black/40 md:hidden"
            onClick={closeMobileContents}
            aria-hidden="true"
          />
          <div
            ref={mobileContentsSheetRef}
            tabIndex={-1}
            className="fixed bottom-0 left-0 right-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl bg-white shadow-xl md:hidden"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <p className="font-semibold text-gray-900">{t("wiki.contents")}</p>
              <button
                type="button"
                onClick={closeMobileContents}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label={t("common:close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-5 px-4 py-3">
              {/* TOC */}
              {tocItems.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
                            onClick={closeMobileContents}
                            className="block truncate py-1 text-sm text-gray-600 hover:text-gray-900"
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
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
                        onClick={closeMobileContents}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Author */}
              {author && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t("wiki.author")}
                  </p>
                  <div className="flex items-center gap-2">
                    {author.image ? (
                      <img
                        src={author.image}
                        alt={author.name}
                        className="h-6 w-6 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                        {author.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="text-sm text-gray-700">{author.name}</span>
                  </div>
                </div>
              )}

              {/* Last edited */}
              {page.updatedAt && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t("wiki.last_edited_by")}
                  </p>
                  <p className="text-xs text-gray-500">
                    {editor ? `${editor.name}, ` : ""}
                    {timeAgo(new Date(page.updatedAt as unknown as string), t)}
                  </p>
                </div>
              )}

              {/* Translation status */}
              {(lang === "en" ? page.translationStatusEn : page.translationStatusJa) === "ai" && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {t("wiki.auto_translated")}
                </span>
              )}

              {/* Sources (URLs, PDFs, and image attachments) */}
              {((sources && sources.length > 0) || (attachments && attachments.length > 0)) && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
                              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline"
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
                                    fill="#4285F4"
                                  />
                                  <path d="M14 2v6h6" fill="#A8C7FA" />
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
                                  <rect width="24" height="24" rx="2" fill="#FBBC04" />
                                  <rect x="4" y="6" width="16" height="12" rx="1" fill="white" />
                                  <polygon points="10,9 10,15 16,12" fill="#FBBC04" />
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
                            className="h-12 w-12 rounded border border-gray-200 object-cover"
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
      )}
    </div>
  );
}
