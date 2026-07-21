import { and, asc, eq, inArray, isNull, like, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../../../../app/db/schema";
import { getEffectivePagePermissions } from "../../../../../app/lib/page-access.server";
import type {
  WikiWorkspaceStore,
  WorkspaceActor,
  WorkspacePage,
  WorkspacePageBody,
} from "../../tools/wiki-workspace/workspace";

type Db = DrizzleD1Database<typeof schema>;
type PageRow = Omit<WorkspacePage, "updatedAt"> & { updatedAt: Date };

export function createD1WikiWorkspaceStore(db: Db, actor: WorkspaceActor): WikiWorkspaceStore {
  const pageColumns = {
    id: schema.pages.id,
    slug: schema.pages.slug,
    titleJa: schema.pages.titleJa,
    titleEn: schema.pages.titleEn,
    summaryJa: schema.pages.summaryJa,
    summaryEn: schema.pages.summaryEn,
    parentId: schema.pages.parentId,
    status: schema.pages.status,
    pageType: schema.pages.pageType,
    pageMetadata: schema.pages.pageMetadata,
    visibility: schema.pages.visibility,
    generalRole: schema.pages.generalRole,
    chapterId: schema.pages.chapterId,
    authorId: schema.pages.authorId,
    updatedAt: schema.pages.updatedAt,
  };
  async function getPage(where: SQL | undefined): Promise<WorkspacePage | null> {
    const page = await db.select(pageColumns).from(schema.pages).where(where).get();
    return page ? (page as PageRow) : null;
  }
  async function bodyFor(id: string): Promise<WorkspacePageBody | null> {
    const page = await db
      .select({
        ...pageColumns,
        contentJa: schema.pages.contentJa,
        contentEn: schema.pages.contentEn,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, id))
      .get();
    if (!page) return null;
    const tagRows = await db
      .select({ tag: schema.pageTags.tagSlug })
      .from(schema.pageTags)
      .where(eq(schema.pageTags.pageId, id))
      .all();
    return { ...page, tags: tagRows.map(({ tag }) => tag) };
  }
  return {
    getRootPage: (slug) => getPage(and(eq(schema.pages.slug, slug), isNull(schema.pages.parentId))),
    getChildPage: (parentId, slug) =>
      getPage(and(eq(schema.pages.slug, slug), eq(schema.pages.parentId, parentId))),
    getPageById: (id) => getPage(eq(schema.pages.id, id)),
    getPageBody: bodyFor,
    listChildren: async (parentId, { limit, offset }) =>
      db
        .select(pageColumns)
        .from(schema.pages)
        .where(
          and(
            parentId ? eq(schema.pages.parentId, parentId) : isNull(schema.pages.parentId),
            eq(schema.pages.status, "published"),
          ),
        )
        .orderBy(asc(schema.pages.sortOrder), asc(schema.pages.slug), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all(),
    findPublicPages: async (query, { limit, offset }) => {
      const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      return db
        .select(pageColumns)
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.status, "published"),
            eq(schema.pages.visibility, "public"),
            or(
              like(schema.pages.slug, pattern),
              like(schema.pages.titleJa, pattern),
              like(schema.pages.titleEn, pattern),
            ),
          ),
        )
        .orderBy(asc(schema.pages.updatedAt), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all();
    },
    grepPublicPages: async (query, { limit, offset }) => {
      const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await db
        .select({
          ...pageColumns,
          contentJa: schema.pages.contentJa,
          contentEn: schema.pages.contentEn,
        })
        .from(schema.pages)
        .where(
          and(
            eq(schema.pages.status, "published"),
            eq(schema.pages.visibility, "public"),
            or(like(schema.pages.contentJa, pattern), like(schema.pages.contentEn, pattern)),
          ),
        )
        .orderBy(asc(schema.pages.updatedAt), asc(schema.pages.id))
        .limit(limit)
        .offset(offset)
        .all();
      const pageIds = rows.map(({ id }) => id);
      const tagRows = pageIds.length
        ? await db
            .select({ pageId: schema.pageTags.pageId, tag: schema.pageTags.tagSlug })
            .from(schema.pageTags)
            .where(inArray(schema.pageTags.pageId, pageIds))
            .all()
        : [];
      const tags = new Map<string, string[]>();
      for (const row of tagRows) tags.set(row.pageId, [...(tags.get(row.pageId) ?? []), row.tag]);
      return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }));
    },
    canView: (page) =>
      getEffectivePagePermissions(
        db,
        page,
        { id: actor.userId, email: actor.email, isAdmin: actor.isAdmin },
        actor.chapterIds,
      ).then(({ canView }) => canView),
  };
}
