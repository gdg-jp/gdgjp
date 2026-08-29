import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { createAuth } from "~/features/auth/auth.server";
import type { requireUser } from "~/features/auth/utils.server";
import {
  type ShareSubject,
  getEffectivePagePermissions,
  normalizeEmail,
} from "~/features/pages/access.server";
import type { getDb } from "~/lib/db.server";

/** Shared helpers for the `/api/pages/:pageId/access` loader and action. */

export type PageRecord = {
  id: string;
  slug: string;
  titleJa: string;
  pageType: string | null;
  parentId: string | null;
  aclSyncedWithParent: boolean;
  authorId: string;
  visibility: string;
  generalRole: string;
};

export type DescendantCounts = { descendantCount: number; syncedDescendantCount: number };

export async function getChapterIds(
  request: Request,
  env: Env,
): Promise<{ chapters: Array<{ chapterId: string; role: string }>; unavailable: boolean }> {
  try {
    const claims = await createAuth(env).getFreshClaims(request);
    return {
      chapters: claims.chapters.map((chapter) => ({
        chapterId: String(chapter.chapterId),
        role: chapter.role,
      })),
      unavailable: false,
    };
  } catch {
    // A stale/failed IdP lookup must never accidentally retain Chapter access.
    return { chapters: [], unavailable: true };
  }
}

export async function loadPage(
  db: ReturnType<typeof getDb>,
  pageId: string,
): Promise<PageRecord | null> {
  return (
    (await db
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        titleJa: schema.pages.titleJa,
        pageType: schema.pages.pageType,
        parentId: schema.pages.parentId,
        aclSyncedWithParent: schema.pages.aclSyncedWithParent,
        authorId: schema.pages.authorId,
        visibility: schema.pages.visibility,
        generalRole: schema.pages.generalRole,
      })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .get()) ?? null
  );
}

export async function getDescendantCounts(env: Env, pageId: string): Promise<DescendantCounts> {
  const row = (await env.DB.prepare(
    `WITH RECURSIVE descendants(id, acl_synced_with_parent) AS (
       SELECT id, acl_synced_with_parent FROM pages WHERE parent_id = ?
       UNION ALL
       SELECT page.id, page.acl_synced_with_parent
       FROM pages AS page JOIN descendants ON page.parent_id = descendants.id
     ), synced_descendants(id) AS (
       SELECT id FROM pages WHERE parent_id = ? AND acl_synced_with_parent = 1
       UNION ALL
       SELECT page.id FROM pages AS page
       JOIN synced_descendants ON page.parent_id = synced_descendants.id
       WHERE page.acl_synced_with_parent = 1
     )
     SELECT
       (SELECT COUNT(*) FROM descendants) AS descendantCount,
       (SELECT COUNT(*) FROM synced_descendants) AS syncedDescendantCount`,
  )
    .bind(pageId, pageId)
    .first()) as { descendantCount: number; syncedDescendantCount: number } | null;
  return {
    descendantCount: Number(row?.descendantCount ?? 0),
    syncedDescendantCount: Number(row?.syncedDescendantCount ?? 0),
  };
}

export async function replaceAclFromParent(
  env: Env,
  sourcePageId: string,
  targetPage: PageRecord,
  grantedBy: string,
) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM page_access WHERE page_id = ?").bind(targetPage.id),
    env.DB.prepare(
      `INSERT INTO page_access (
         id, page_id, subject_type, subject_key, subject_label, user_id, role, granted_by,
         created_at, updated_at
       )
       SELECT lower(hex(randomblob(16))), ?, subject_type, subject_key, subject_label, user_id,
              role, ?, unixepoch(), unixepoch()
       FROM page_access WHERE page_id = ?`,
    ).bind(targetPage.id, grantedBy, sourcePageId),
    env.DB.prepare(
      `UPDATE pages
       SET visibility = (SELECT visibility FROM pages WHERE id = ?),
           general_role = (SELECT general_role FROM pages WHERE id = ?),
           acl_synced_with_parent = 1,
           updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(sourcePageId, sourcePageId, targetPage.id),
  ]);
}

export async function markAclChanged(db: ReturnType<typeof getDb>, page: PageRecord) {
  await db
    .update(schema.pages)
    .set({ aclSyncedWithParent: page.parentId === null, updatedAt: new Date() })
    .where(eq(schema.pages.id, page.id));
}

export function asShareSubject(value: unknown): ShareSubject | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const subjectType = raw.subjectType ?? raw.type;
  const subjectKey = raw.subjectKey ?? raw.key ?? raw.email ?? raw.id;
  const subjectLabel = raw.subjectLabel ?? raw.label ?? raw.name ?? raw.email;
  if ((subjectType !== "email" && subjectType !== "chapter") || typeof subjectKey !== "string") {
    return null;
  }
  if (typeof subjectLabel !== "string" || !subjectLabel.trim()) return null;
  if (subjectType === "email" && (!subjectKey.includes("@") || subjectKey.length > 320))
    return null;
  if (subjectKey.length > 320 || subjectLabel.length > 320) return null;
  return {
    subjectType,
    subjectKey: subjectType === "email" ? normalizeEmail(subjectKey) : subjectKey,
    subjectLabel: subjectLabel.trim(),
    userId: typeof raw.userId === "string" ? raw.userId : null,
  };
}

async function invalidateCollaboration(env: Env, slug: string): Promise<void> {
  const id = env.COLLAB_DO.idFromName(slug);
  await env.COLLAB_DO.get(id).fetch("https://collab.internal/access-changed", { method: "POST" });
}

export async function invalidateCollaborationBestEffort(env: Env, slug: string): Promise<void> {
  try {
    await invalidateCollaboration(env, slug);
  } catch (error) {
    console.error("Failed to disconnect collaborative editing sessions", error);
  }
}

export async function requireSharingPermissions(
  db: ReturnType<typeof getDb>,
  page: PageRecord,
  request: Request,
  env: Env,
  user: Awaited<ReturnType<typeof requireUser>>,
) {
  const claims = await getChapterIds(request, env);
  const permissions = await getEffectivePagePermissions(db, page, user, claims.chapters);
  return { permissions, chapters: claims.chapters, claimsUnavailable: claims.unavailable };
}
