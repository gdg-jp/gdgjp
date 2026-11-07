import { and, eq } from "drizzle-orm";
import { redirect } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getAccessIdentity, requireUser } from "~/features/auth/utils.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { scheduleKnowledgeSync } from "~/features/knowledge/sync.server";
import { getEffectivePagePermissions } from "~/features/pages/access.server";
import { redactPageMarkdown } from "~/features/pages/acl-spans.server";
import { archivePageAndDescendants } from "~/features/pages/archive.server";
import { canHumanEditPage } from "~/features/pages/origin-lock";
import { classifyWikiRequestPath, wikiPagePath } from "~/features/pages/wiki-page-path";
import { getWikiAncestry, getWikiCanonicalSlugPath } from "~/features/pages/wiki-page-path.server";
import { requireSpace } from "~/features/spaces/access.server";
import { roleAtLeast, spacePath } from "~/features/spaces/shared";
import { rememberLastSpace } from "~/features/spaces/viewer.server";
import { getDb } from "~/lib/db.server";
import { duplicatePage } from "./duplicate.server";
import { loadInlineSourceRefs } from "./inline-source-refs.server";
import { movePage } from "./move.server";
import { handlePageAgentIntent } from "./page-agent-actions.server";
import { loadPageComments } from "./page-comments.server";
import { pageInSpace } from "./page-space.server";

type WikiDb = ReturnType<typeof getDb>;

/** Data assembly behind the `/wiki/*` page loader. */
export async function loadWikiPage({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  // Outer layer first: the space must be reachable, then the inner page ACL runs.
  const { space, role: spaceRole, identity } = await requireSpace(request, env, params.space);
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
      origin: schema.pages.origin,
      spaceId: schema.pages.spaceId,
    })
    .from(schema.pages)
    .where(pageInSpace(space.id, leafSlug))
    .get();

  if (!page || page.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  const permissions = await getEffectivePagePermissions(db, page, sessionUser, identity.chapters);
  if (!permissions.canView) {
    // A shared link opened while signed out: offer sign-in and come back here, instead of a
    // 404 that reads as "this page was deleted".
    if (!sessionUser) {
      const here = new URL(request.url);
      throw redirect(`/signin?return_to=${encodeURIComponent(here.pathname + here.search)}`);
    }
    if (!identity.claimsAvailable && page.visibility === "restricted") {
      throw new Response("Access service temporarily unavailable", { status: 503 });
    }
    throw new Response("Not Found", { status: 404 });
  }

  const chain = (await getWikiAncestry(env, [page.id])).get(page.id) ?? [];
  const canonical =
    chain.length > 0 ? chain.map((a) => a.slug) : await getWikiCanonicalSlugPath(env, page.id);
  const classification = classifyWikiRequestPath(segments, canonical);
  if (classification === "redirect") {
    const url = new URL(request.url);
    throw redirect(wikiPagePath(canonical, space.slug) + url.search, 301);
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
      .select({
        url: schema.pageSources.url,
        title: schema.pageSources.title,
        sourceId: schema.pageSources.sourceId,
      })
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
    context.cloudflare.ctx.waitUntil(rememberLastSpace(env, sessionUser.id, space.id));
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

  // The body carries its sources so inline `(source: id)` citations render as links at once.
  // Agent pages cite a source id or a source-document id, not always one linked to the page.
  const content = Promise.all([
    redactPageMarkdown(db, canonicalMarkdown(page.contentJa), sessionUser, identity.chapters),
    redactPageMarkdown(db, canonicalMarkdown(page.contentEn), sessionUser, identity.chapters),
    loadInlineSourceRefs(db, page.id, `${page.contentJa}\n${page.contentEn}`),
  ]).then(([contentJa, contentEn, sourceRefs]) => ({
    contentJa,
    contentEn,
    sourceRefs,
  }));

  // Parents (root first) for the breadcrumb above the title.
  const ancestors = chain.slice(0, -1).map((a) => ({
    slug: a.slug,
    titleJa: a.titleJa,
    titleEn: a.titleEn,
    path: wikiPagePath(
      chain.slice(0, chain.indexOf(a) + 1).map((x) => x.slug),
      space.slug,
    ),
  }));

  const { contentJa: _ja, contentEn: _en, ...pageMetadata } = page;

  const canEditInSpace = roleAtLeast(spaceRole, "editor");
  return {
    space: { id: space.id, slug: space.slug, name: space.name, kind: space.kind },
    spaceRole,
    page: pageMetadata,
    ancestors,
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
    // Agent pages: people ask the agent instead of editing (§8-6).
    canAskAgent: page.origin === "agent" && canEditInSpace && permissions.canView,
    canEdit:
      canHumanEditPage(page) &&
      canEditInSpace &&
      page.pageType !== "wiki-index" &&
      page.pageType !== "wiki-log" &&
      permissions.canEdit,
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
  const { space } = await requireSpace(request, env, params.space);
  const db = getDb(env);

  const segments = (params["*"] ?? "").split("/").filter(Boolean);
  const leafSlug = segments.at(-1) ?? "";

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "duplicatePage" || intent === "movePage") {
    const page = await db
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(pageInSpace(space.id, leafSlug))
      .get();
    if (!page) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      let path: string;
      if (intent === "duplicatePage") {
        const identity = await getAccessIdentity(request, env);
        path = await duplicatePage(
          env,
          sessionUser,
          identity.chapters,
          page.id,
          new URL(request.url).origin,
        );
      } else {
        const parentId = form.get("parentId");
        if (typeof parentId !== "string")
          return Response.json({ error: "invalid_parent" }, { status: 400 });
        await movePage(env, sessionUser, {
          pageId: page.id,
          newParentId: parentId || null,
          insertAfterId: null,
          append: true,
        });
        path = wikiPagePath(await getWikiCanonicalSlugPath(env, page.id), space.slug);
      }
      return redirect(`${path}?lang=${form.get("lang") === "en" ? "en" : "ja"}`);
    } catch (error) {
      if (!(error instanceof Response)) console.error("[page-menu] action failed", error);
      return Response.json(
        { error: "page_action_failed" },
        { status: error instanceof Response ? error.status : 500 },
      );
    }
  }

  if (intent === "translateNow" || intent === "askAgent") {
    return handlePageAgentIntent(request, env, {
      intent,
      spaceSlug: params.space,
      spaceId: space.id,
      leafSlug,
      form,
      user: sessionUser,
    });
  }

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
      .where(pageInSpace(space.id, leafSlug))
      .get();
    if (!page) throw new Response("Not Found", { status: 404 });
    if (page.pageType === "wiki-index" || page.pageType === "wiki-log") {
      throw new Response("This page is maintained by the ingest toolchain", { status: 403 });
    }
    const isAuthor = sessionUser.id === page.authorId;
    if (!isAuthor && !sessionUser.isAdmin) throw new Response("Forbidden", { status: 403 });
    await archivePageAndDescendants(env, db, page.id);
    context.cloudflare.ctx.waitUntil(scheduleKnowledgeSync(env, space.id));
    return redirect(spacePath(space.slug));
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
        .where(pageInSpace(space.id, leafSlug))
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
