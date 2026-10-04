import type { Link } from "~/features/links/link-record";
import type { LinkRow } from "~/features/links/link-record";
import { toLink } from "~/features/links/link-record";
import { linkColumns } from "~/features/links/link-record";
import { LINK_COLS } from "~/features/links/link-record";

export async function listLinksForUser(
  db: D1Database,
  userId: string,
  includeArchived = false,
): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE owner_user_id = ? AND (? = 1 OR archived_at IS NULL) AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(userId, includeArchived ? 1 : 0)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function listPublicLinks(db: D1Database, includeArchived = false): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE visibility = 'public' AND (? = 1 OR archived_at IS NULL) AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(includeArchived ? 1 : 0)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function getLinkBySlug(
  db: D1Database,
  slug: string,
  hostname = "gdgs.jp",
): Promise<Link | null> {
  const row = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE domain_id = (SELECT id FROM domains WHERE hostname = ? COLLATE NOCASE AND status = 'active' AND deleted_at IS NULL)
         AND slug = ? AND deleted_at IS NULL`,
    )
    .bind(hostname, slug)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function listLinksForChapter(
  db: D1Database,
  chapterId: number,
  includeArchived = false,
): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links
       WHERE owner_chapter_id = ? AND (? = 1 OR archived_at IS NULL) AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    )
    .bind(chapterId, includeArchived ? 1 : 0)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function listLinksAccessibleByEmail(
  db: D1Database,
  email: string,
  chapterId: number | null,
  includeArchived = false,
): Promise<Link[]> {
  const linkCols = linkColumns("l");
  if (chapterId == null) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT ${linkCols}
         FROM links l
         JOIN link_permissions p ON p.link_id = l.id
         WHERE (? = 1 OR l.archived_at IS NULL) AND l.deleted_at IS NULL
           AND p.principal_type = 'user' AND p.principal_id = ?
         ORDER BY l.created_at DESC`,
      )
      .bind(includeArchived ? 1 : 0, email)
      .all<LinkRow>();
    return results.map(toLink);
  }
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${linkCols}
       FROM links l
       JOIN link_permissions p ON p.link_id = l.id
       WHERE (? = 1 OR l.archived_at IS NULL) AND l.deleted_at IS NULL
         AND (
           (p.principal_type = 'user' AND p.principal_id = ?)
           OR (p.principal_type = 'chapter' AND p.principal_id = ?)
         )
       ORDER BY l.created_at DESC`,
    )
    .bind(includeArchived ? 1 : 0, email, String(chapterId))
    .all<LinkRow>();
  return results.map(toLink);
}
