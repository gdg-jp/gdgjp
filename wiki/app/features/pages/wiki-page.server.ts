import { and, asc, eq, inArray } from "drizzle-orm";
import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { redactPageMarkdown } from "~/features/pages/acl-spans.server";
import { archivePageAndDescendants } from "~/features/pages/archive.server";
import { classifyWikiRequestPath, wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { getDb } from "~/lib/db.server";

type WikiDb = ReturnType<typeof getDb>;

async function loadPageComments(db: WikiDb, pageId: string, sessionUserId: string | undefined) {
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
    .where(eq(schema.pageComments.pageId, pageId))
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

  const reactionsByComment = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean }[]
  >();
  for (const r of reactionsRaw) {
    const list = reactionsByComment.get(r.commentId) ?? [];
    const existing = list.find((x) => x.emoji === r.emoji);
    if (existing) {
      existing.count++;
      if (r.userId === sessionUserId) existing.reactedByMe = true;
    } else {
      list.push({ emoji: r.emoji, count: 1, reactedByMe: r.userId === sessionUserId });
    }
    reactionsByComment.set(r.commentId, list);
  }

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
  return topLevelComments;
}

/** Data assembly behind the `/wiki/*` page loader. */
export async function loadWikiPage({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getAccessIdentity(request, env);
  const sessionUser = identity.user;
  const db = getDb(env);

  const segments = (params["*"] ?? "").split("/").filter(Boolean);
  const leafSlug = segments.at(-1) ?? "";

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
    .where(eq(schema.pages.slug, leafSlug))
    .get();

  if (!page || page.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  const permissions = await getEffectivePagePermissions(db, page, sessionUser, identity.chapters);
  if (!permissions.canView) {
    if (!identity.claimsAvailable && page.visibility === "restricted") {
      throw new Response("Access service temporarily unavailable", { status: 503 });
    }
    throw new Response("Not Found", { status: 404 });
  }

  const canonical = await getWikiCanonicalSlugPath(env, page.id);
  const classification = classifyWikiRequestPath(segments, canonical);
  if (classification === "redirect") {
    const url = new URL(request.url);
    throw redirect(wikiPagePath(canonical) + url.search, 301);
  }
  if (classification === "not-found") {
    throw new Response("Not Found", { status: 404 });
  }

  const comments = loadPageComments(db, page.id, sessionUser?.id);

  const pageMeta = Promise.all([
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
  ]).then(([tags, authorRow, editorRow, fav, sources, attachments]) => ({
    tags,
    author: authorRow ?? null,
    editor: editorRow ?? null,
    isStarred: !!fav,
    sources,
    attachments,
  }));

  const url = new URL(request.url);
  const langParam = url.searchParams.get("lang");
  const lang: "ja" | "en" = langParam === "ja" || langParam === "en" ? langParam : "ja";

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

  const content = Promise.all([
    redactPageMarkdown(db, canonicalMarkdown(page.contentJa), sessionUser, identity.chapters),
    redactPageMarkdown(db, canonicalMarkdown(page.contentEn), sessionUser, identity.chapters),
  ]).then(([contentJa, contentEn]) => ({
    contentJa,
    contentEn,
  }));

  const { contentJa: _ja, contentEn: _en, ...pageMetadata } = page;

  return {
    page: pageMetadata,
    content,
    pageMeta,
    lang,
    isAdmin: sessionUser?.isAdmin ?? false,
    isAuthor: sessionUser?.id === page.authorId,
    canArchive:
      page.pageType !== "wiki-index" &&
      page.pageType !== "wiki-log" &&
      !!sessionUser &&
      (sessionUser.id === page.authorId || sessionUser.isAdmin),
    currentUserId: sessionUser?.id ?? null,
    isAuthenticated: !!sessionUser,
    canComment: permissions.canComment,
    canEdit: page.pageType !== "wiki-index" && page.pageType !== "wiki-log" && permissions.canEdit,
    visibility: page.visibility,
    canChangeVisibility: permissions.canManageSharing,
    canManageAccess: permissions.canManageSharing,
    comments,
  };
}

/** Favorite toggle / archive / author change behind the `/wiki/*` action. */
export async function handleWikiPageAction({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const sessionUser = await requireUser(request, env);
  const db = getDb(env);

  const segments = (params["*"] ?? "").split("/").filter(Boolean);
  const leafSlug = segments.at(-1) ?? "";

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
      .select({
        id: schema.pages.id,
        authorId: schema.pages.authorId,
        pageType: schema.pages.pageType,
      })
      .from(schema.pages)
      .where(eq(schema.pages.slug, leafSlug))
      .get();
    if (!page) throw new Response("Not Found", { status: 404 });
    if (page.pageType === "wiki-index" || page.pageType === "wiki-log") {
      throw new Response("This page is maintained by the ingest toolchain", { status: 403 });
    }
    const isAuthor = sessionUser.id === page.authorId;
    if (!isAuthor && !sessionUser.isAdmin) throw new Response("Forbidden", { status: 403 });
    await archivePageAndDescendants(env, db, page.id);
    return redirect("/");
  }

  if (intent === "changeAuthor") {
    if (!sessionUser.isAdmin) throw new Response("Forbidden", { status: 403 });
    const authorId = form.get("authorId");
    if (typeof authorId !== "string" || !authorId) {
      return new Response("Missing authorId", { status: 400 });
    }

    const [page, author] = await Promise.all([
      db
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(eq(schema.pages.slug, leafSlug))
        .get(),
      db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, authorId)).get(),
    ]);
    if (!page || !author) throw new Response("Not Found", { status: 404 });

    await db
      .update(schema.pages)
      .set({ authorId: author.id, updatedAt: new Date() })
      .where(eq(schema.pages.id, page.id));
    return { ok: true };
  }

  return new Response("Unknown intent", { status: 400 });
}
