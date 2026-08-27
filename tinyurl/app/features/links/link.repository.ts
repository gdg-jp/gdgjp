import {
  COMMENT_COLS,
  type Comment,
  type CommentRow,
  LINK_COLS,
  linkColumns,
  type Link,
  type LinkPermission,
  type LinkPermissionRow,
  type LinkRole,
  type LinkRow,
  type LinkVisibility,
  PERM_COLS,
  type PrincipalType,
  toComment,
  toLink,
  toLinkPermission,
} from "~/lib/db";
import { newLinkId } from "~/lib/id";

export async function getLinkById(db: D1Database, id: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function listVisibleLinksPage(
  db: D1Database,
  input: {
    userId: string;
    email: string;
    chapterIds: number[];
    isSuperAdmin?: boolean;
    folderId?: number;
    tagId?: number;
    limit: number;
    offset: number;
  },
): Promise<{ links: Link[]; nextCursor: string | null }> {
  const conditions = ["l.deleted_at IS NULL"];
  const values: (string | number)[] = [];
  if (!input.isSuperAdmin) {
    conditions.push("(l.owner_user_id = ? OR l.owner_chapter_id IN (SELECT value FROM json_each(?)) OR l.visibility = 'public' OR EXISTS (SELECT 1 FROM link_permissions p WHERE p.link_id = l.id AND ((p.principal_type = 'user' AND p.principal_id = ?) OR (p.principal_type = 'chapter' AND p.principal_id IN (SELECT value FROM json_each(?))))))");
    values.push(input.userId, JSON.stringify(input.chapterIds), input.email, JSON.stringify(input.chapterIds));
  }
  if (input.folderId !== undefined) { conditions.push("l.folder_id = ?"); values.push(input.folderId); }
  if (input.tagId !== undefined) { conditions.push("EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id AND lt.tag_id = ?)"); values.push(input.tagId); }
  const { results } = await db.prepare(`SELECT ${linkColumns("l")} FROM links l WHERE ${conditions.join(" AND ")} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`).bind(...values, input.limit + 1, input.offset).all<LinkRow>();
  const page = results.map(toLink);
  const hasMore = page.length > input.limit;
  return { links: page.slice(0, input.limit), nextCursor: hasMore ? btoa(String(input.offset + input.limit)) : null };
}

export type CreateLinkRecord = {
  domainId?: number;
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  ownerUserId: string;
  ownerChapterId?: number | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  visibility?: LinkVisibility;
};

export type CreateLinkResult = { ok: true; link: Link } | { ok: false; reason: "slug_taken" };

export async function createLink(
  db: D1Database,
  input: CreateLinkRecord,
): Promise<CreateLinkResult> {
  const ownerChapterId = input.ownerChapterId ?? null;
  try {
    const row = await db
      .prepare(
        `INSERT INTO links (id, domain_id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, campaign_channel_id, folder_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${LINK_COLS}`,
      )
      .bind(
        newLinkId(),
        input.domainId ?? 1,
        input.slug,
        input.destinationUrl,
        input.title ?? null,
        input.description ?? null,
        input.ogImageUrl ?? null,
        input.ownerUserId,
        ownerChapterId,
        input.campaignChannelId ?? null,
        input.folderId ?? null,
        input.visibility ?? "private",
      )
      .first<LinkRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, link: toLink(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE")) return { ok: false, reason: "slug_taken" };
    throw err;
  }
}

export type UpdateLinkRecord = {
  domainId?: number;
  slug?: string;
  destinationUrl?: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  visibility?: LinkVisibility;
  ownerChapterId?: number | null;
};

export async function updateLink(
  db: D1Database,
  id: string,
  input: UpdateLinkRecord,
): Promise<Link | null> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.domainId !== undefined) {
    sets.push("domain_id = ?");
    values.push(input.domainId);
  }
  if (input.slug !== undefined) {
    sets.push("slug = ?");
    values.push(input.slug);
  }
  if (input.destinationUrl !== undefined) {
    sets.push("destination_url = ?");
    values.push(input.destinationUrl);
  }
  if (input.title !== undefined) {
    sets.push("title = ?");
    values.push(input.title);
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    values.push(input.description);
  }
  if (input.ogImageUrl !== undefined) {
    sets.push("og_image_url = ?");
    values.push(input.ogImageUrl);
  }
  if (input.campaignChannelId !== undefined) {
    sets.push("campaign_channel_id = ?");
    values.push(input.campaignChannelId);
  }
  if (input.folderId !== undefined) {
    sets.push("folder_id = ?");
    values.push(input.folderId);
  }
  if (input.visibility !== undefined) {
    sets.push("visibility = ?");
    values.push(input.visibility);
  }
  if (input.ownerChapterId !== undefined) {
    sets.push("owner_chapter_id = ?");
    values.push(input.ownerChapterId);
  }
  if (sets.length === 0) return getLinkById(db, id);
  sets.push("updated_at = unixepoch()");
  const row = await db
    .prepare(
      `UPDATE links SET ${sets.join(", ")} WHERE id = ? AND deleted_at IS NULL RETURNING ${LINK_COLS}`,
    )
    .bind(...values, id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function softDeleteLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE links SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .run();
}

export async function archiveLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE links SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND archived_at IS NULL AND deleted_at IS NULL",
    )
    .bind(id)
    .run();
}

export async function restoreLink(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE links SET archived_at = NULL, updated_at = unixepoch() WHERE id = ? AND archived_at IS NOT NULL AND deleted_at IS NULL",
    )
    .bind(id)
    .run();
}

export async function deleteLink(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
}

// ---------- Tags ----------

export async function setLinkTags(db: D1Database, linkId: string, tagIds: number[]): Promise<void> {
  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId),
  ];
  for (const tagId of tagIds) {
    stmts.push(
      db
        .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
        .bind(linkId, tagId),
    );
  }
  await db.batch(stmts);
}

/**
 * `createTag` can fail on a name that already exists for this owner (or is a
 * shared chapter/global tag) — this resolves the id it collided with.
 */
export async function findExistingTagId(
  db: D1Database,
  name: string,
  ownerUserId: string,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT id FROM tags WHERE name = ? AND (owner_user_id = ? OR owner_user_id IS NULL)")
    .bind(name, ownerUserId)
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function listAllowedTagIds(
  db: D1Database,
  userId: string,
  tagIds: number[],
): Promise<number[]> {
  const ids = [...new Set(tagIds)];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT id FROM tags
       WHERE id IN (${placeholders})
         AND (owner_user_id = ? OR owner_user_id IS NULL)`,
    )
    .bind(...ids, userId)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

// ---------- Comments ----------

export async function listComments(db: D1Database, linkId: string): Promise<Comment[]> {
  const { results } = await db
    .prepare(`SELECT ${COMMENT_COLS} FROM comments WHERE link_id = ? ORDER BY created_at`)
    .bind(linkId)
    .all<CommentRow>();
  return results.map(toComment);
}

export async function addComment(
  db: D1Database,
  input: { linkId: string; authorUserId: string; body: string },
): Promise<Comment> {
  const row = await db
    .prepare(
      `INSERT INTO comments (link_id, author_user_id, body)
       VALUES (?, ?, ?)
       RETURNING ${COMMENT_COLS}`,
    )
    .bind(input.linkId, input.authorUserId, input.body)
    .first<CommentRow>();
  if (!row) throw new Error("Insert returned no row");
  return toComment(row);
}

export async function deleteComment(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
}

// ---------- Permissions ----------

export async function listPermissionsForLink(
  db: D1Database,
  linkId: string,
): Promise<LinkPermission[]> {
  const { results } = await db
    .prepare(`SELECT ${PERM_COLS} FROM link_permissions WHERE link_id = ? ORDER BY created_at`)
    .bind(linkId)
    .all<LinkPermissionRow>();
  return results.map(toLinkPermission);
}

export async function copyFolderPermissionsToLink(
  db: D1Database,
  folderId: number,
  linkId: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO link_permissions (link_id, principal_type, principal_id, role)
       SELECT ?, principal_type, principal_id, role FROM folder_permissions WHERE folder_id = ?
       ON CONFLICT(link_id, principal_type, principal_id) DO NOTHING`,
    )
    .bind(linkId, folderId)
    .run();
}

export type AddPermissionInput = {
  linkId: string;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
};

export type AddPermissionResult =
  | { ok: true; permission: LinkPermission }
  | { ok: false; reason: "duplicate" };

export async function addPermission(
  db: D1Database,
  input: AddPermissionInput,
): Promise<AddPermissionResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO link_permissions (link_id, principal_type, principal_id, role)
         VALUES (?, ?, ?, ?)
         RETURNING ${PERM_COLS}`,
      )
      .bind(input.linkId, input.principalType, input.principalId, input.role)
      .first<LinkPermissionRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, permission: toLinkPermission(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function removePermission(
  db: D1Database,
  linkId: string,
  id: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM link_permissions WHERE id = ? AND link_id = ?")
    .bind(id, linkId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function updatePermissionRole(
  db: D1Database,
  linkId: string,
  id: number,
  role: LinkRole,
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE link_permissions SET role = ? WHERE id = ? AND link_id = ?")
    .bind(role, id, linkId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
