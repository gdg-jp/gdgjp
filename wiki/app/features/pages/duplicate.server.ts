import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "~/db/schema";
import type { AccessIdentity, AuthUser } from "~/features/auth/utils.server";
import { canonicalMarkdown } from "~/features/editor/content-format";
import { pageAclClearance } from "~/features/pages/acl-spans.server";
import { getDb } from "~/lib/db.server";
import { rewriteCopiedLinks } from "./page-menu-content";
import { wikiPagePath } from "./wiki-page-path";
import { getWikiCanonicalSlugPaths } from "./wiki-page-path.server";

type Page = typeof schema.pages.$inferSelect;

/** Copy only published branches; UNION also terminates corrupt cyclic trees. */
export async function duplicatePage(
  env: Env,
  user: AuthUser,
  chapters: AccessIdentity["chapters"],
  pageId: string,
  origin: string,
) {
  const db = getDb(env);
  const tree = await env.DB.prepare(`WITH RECURSIVE subtree(id) AS (
    SELECT id FROM pages WHERE id = ? AND status = 'published'
    UNION SELECT p.id FROM pages p JOIN subtree s ON p.parent_id = s.id
    WHERE p.status = 'published'
  ) SELECT id FROM subtree`)
    .bind(pageId)
    .all<{ id: string }>();
  const pages: Page[] = [];
  for (const { id } of tree.results) {
    const page = await db.select().from(schema.pages).where(eq(schema.pages.id, id)).get();
    if (!page || page.status !== "published") throw new Response("Page changed", { status: 409 });
    if (
      (!user.isAdmin && page.authorId !== user.id) ||
      page.pageType === "wiki-index" ||
      page.pageType === "wiki-log" ||
      !(await pageAclClearance(
        db,
        [canonicalMarkdown(page.contentJa), canonicalMarkdown(page.contentEn)],
        user,
        chapters,
      ))
    ) {
      throw new Response("Cannot duplicate this page tree", { status: 403 });
    }
    pages.push(page);
  }
  const root = pages.find((page) => page.id === pageId);
  if (!root) throw new Response("Not Found", { status: 404 });
  const ids = new Map(pages.map((page) => [page.id, nanoid()]));
  const slugs = new Map(pages.map((page) => [page.id, `${page.slug}-copy-${nanoid(10)}`]));
  const oldPaths = await getWikiCanonicalSlugPaths(
    env,
    pages.map((page) => page.id),
  );
  const lookup = (map: Map<string, string>, key: string | null) => {
    const value = key ? map.get(key) : undefined;
    if (!value) throw new Response("Invalid page tree", { status: 409 });
    return value;
  };
  const newPath = (initialPage: Page) => {
    let page = initialPage;
    const segments = [lookup(slugs, page.id)];
    const seen = new Set([page.id]);
    while (page.id !== pageId) {
      const parent = pages.find((item) => item.id === page.parentId);
      if (!parent || seen.has(parent.id)) throw new Response("Invalid page tree", { status: 409 });
      seen.add(parent.id);
      segments.unshift(lookup(slugs, parent.id));
      page = parent;
    }
    return wikiPagePath(segments);
  };
  const links = new Map<string, string>();
  for (const page of pages) {
    links.set(wikiPagePath(oldPaths.get(page.id) ?? [page.slug]), newPath(page));
    links.set(wikiPagePath([page.slug]), newPath(page));
  }

  // Copy objects first; publish the complete relational graph in one transaction.
  const copiedKeys: string[] = [];
  const statements: D1PreparedStatement[] = [];
  const insert = (table: string, values: Record<string, string | number | null>) => {
    const keys = Object.keys(values);
    statements.push(
      env.DB.prepare(
        `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ).bind(...Object.values(values)),
    );
  };
  try {
    const attachments = [];
    for (const page of pages) {
      for (const attachment of await db
        .select()
        .from(schema.pageAttachments)
        .where(eq(schema.pageAttachments.pageId, page.id))
        .all()) {
        const key = `wiki/${ids.get(page.id)}/${nanoid()}-${attachment.fileName.replace(/[^\w.\-]/g, "_")}`;
        const object = await env.BUCKET.get(attachment.r2Key);
        if (!object) throw new Error("Attachment is missing");
        copiedKeys.push(key);
        await env.BUCKET.put(key, object.body, {
          httpMetadata: object.httpMetadata,
          customMetadata: object.customMetadata,
        });
        links.set(`/api/images/${attachment.r2Key}`, `/api/images/${key}`);
        attachments.push({ ...attachment, newKey: key });
      }
    }
    // Parents must precede children for foreign keys, independent of query order.
    pages.sort((a, b) => newPath(a).split("/").length - newPath(b).split("/").length);
    for (const page of pages) {
      insert("pages", {
        id: lookup(ids, page.id),
        slug: lookup(slugs, page.id),
        title_ja: page.titleJa ? page.titleJa + (page.id === pageId ? " コピー" : "") : "",
        title_en: page.titleEn ? page.titleEn + (page.id === pageId ? " (Copy)" : "") : "",
        content_ja: rewriteCopiedLinks(canonicalMarkdown(page.contentJa), links, origin),
        content_en: rewriteCopiedLinks(canonicalMarkdown(page.contentEn), links, origin),
        translation_status_ja: page.translationStatusJa,
        translation_status_en: page.translationStatusEn,
        summary_ja: page.summaryJa,
        summary_en: page.summaryEn,
        parent_id: page.id === pageId ? null : lookup(ids, page.parentId),
        sort_order: page.sortOrder,
        acl_synced_with_parent: 1,
        status: "published",
        visibility: "restricted",
        general_role: "viewer",
        origin: "human",
        author_id: user.id,
        last_edited_by: user.id,
        acl_source_ids: page.aclSourceIds,
        page_type: page.pageType,
        page_metadata: page.pageMetadata,
      });
    }
    for (const page of pages) {
      for (const tag of await db
        .select()
        .from(schema.pageTags)
        .where(eq(schema.pageTags.pageId, page.id))
        .all()) {
        insert("page_tags", { page_id: lookup(ids, page.id), tag_slug: tag.tagSlug });
      }
      for (const source of await db
        .select()
        .from(schema.pageSources)
        .where(eq(schema.pageSources.pageId, page.id))
        .all()) {
        insert("page_sources", {
          id: nanoid(),
          page_id: lookup(ids, page.id),
          url: source.url,
          title: source.title,
          source_id: source.sourceId,
        });
      }
    }
    for (const attachment of attachments) {
      insert("page_attachments", {
        id: nanoid(),
        page_id: lookup(ids, attachment.pageId),
        r2_key: attachment.newKey,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
      });
    }
    await env.DB.batch(statements);
  } catch (error) {
    const cleanup = await Promise.allSettled(copiedKeys.map((key) => env.BUCKET.delete(key)));
    for (const result of cleanup)
      if (result.status === "rejected")
        console.error("[page-duplicate] attachment cleanup failed", result.reason);
    throw error;
  }
  return newPath(root);
}
