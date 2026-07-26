import { eq } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getCliIdentity } from "~/lib/cli-identity.server";
import { canonicalMarkdown } from "~/lib/content-format";
import { getDb } from "~/lib/db.server";
import { getEffectivePagePermissions } from "~/lib/page-access.server";

/**
 * Snapshot is an external contract: retain this normalization while old rows
 * may exist during a rolling migration, even though persisted content is Markdown.
 */
export function snapshotContentAsMarkdown(content: string): string {
  return canonicalMarkdown(content);
}

/** GET /api/cli/wiki/snapshot -- all non-archived, non-task pages the token can view. */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const identity = await getCliIdentity(request, env);
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });
  const db = getDb(env);
  const [pages, tags, access, sources, attachments] = await Promise.all([
    db.select().from(schema.pages).all(),
    db.select().from(schema.pageTags).all(),
    db.select().from(schema.pageAccess).all(),
    db.select().from(schema.pageSources).all(),
    db.select().from(schema.pageAttachments).all(),
  ]);
  const chapterIds = identity.chapters.map((chapter) => String(chapter.chapterId));
  const visible = [];
  for (const page of pages) {
    if (page.status === "archived" || page.pageType === "task-list") continue;
    const permissions = await getEffectivePagePermissions(db, page, identity.user, chapterIds);
    if (!permissions.canView) continue;
    visible.push({
      id: page.id,
      slug: page.slug,
      parentId: page.parentId,
      sortOrder: page.sortOrder,
      revision: page.syncRevision,
      ja: {
        title: page.titleJa,
        summary: page.summaryJa,
        translationStatus: page.translationStatusJa,
        content: snapshotContentAsMarkdown(page.contentJa),
      },
      en: {
        title: page.titleEn,
        summary: page.summaryEn,
        translationStatus: page.translationStatusEn,
        content: snapshotContentAsMarkdown(page.contentEn),
      },
      status: page.status,
      pageType: page.pageType,
      pageMetadata: page.pageMetadata ? JSON.parse(page.pageMetadata) : null,
      visibility: page.visibility,
      generalRole: page.generalRole,
      chapterId: page.chapterId,
      tags: tags.filter((row) => row.pageId === page.id).map((row) => row.tagSlug),
      access: access
        .filter((row) => row.pageId === page.id)
        .map(({ id, subjectType, subjectKey, subjectLabel, role }) => ({
          id,
          subjectType,
          subjectKey,
          subjectLabel,
          role,
        })),
      sources: sources
        .filter((row) => row.pageId === page.id)
        .map(({ id, url, title }) => ({ id, url, title })),
      attachments: attachments
        .filter((row) => row.pageId === page.id)
        .map(({ id, r2Key, fileName, mimeType }) => ({
          id,
          r2Key,
          fileName,
          mimeType,
          downloadUrl: `/api/cli/wiki/attachments/${id}`,
        })),
    });
  }
  return Response.json({ version: 1, pages: visible });
}
