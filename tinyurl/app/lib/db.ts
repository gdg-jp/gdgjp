import { newLinkId } from "./id";

export type LinkVisibility = "private" | "public";

export type Link = {
  id: string;
  slug: string;
  destinationUrl: string;
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
  ownerUserId: string;
  ownerChapterId: number | null;
  visibility: LinkVisibility;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type LinkRow = {
  id: string;
  slug: string;
  destination_url: string;
  title: string | null;
  description: string | null;
  og_image_url: string | null;
  owner_user_id: string;
  owner_chapter_id: number | null;
  visibility: LinkVisibility;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

export function toLink(row: LinkRow): Link {
  return {
    id: row.id,
    slug: row.slug,
    destinationUrl: row.destination_url,
    title: row.title,
    description: row.description,
    ogImageUrl: row.og_image_url,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const LINK_COLS =
  "id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, visibility, created_at, updated_at, deleted_at";

export async function listLinksForUser(db: D1Database, userId: string): Promise<Link[]> {
  const { results } = await db
    .prepare(
      `SELECT ${LINK_COLS} FROM links WHERE owner_user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<LinkRow>();
  return results.map(toLink);
}

export async function getLinkBySlug(db: D1Database, slug: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE slug = ? AND deleted_at IS NULL`)
    .bind(slug)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export async function getLinkById(db: D1Database, id: string): Promise<Link | null> {
  const row = await db
    .prepare(`SELECT ${LINK_COLS} FROM links WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<LinkRow>();
  return row ? toLink(row) : null;
}

export type CreateLinkInput = {
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  ownerUserId: string;
  ownerChapterId?: number | null;
  visibility?: LinkVisibility;
};

export type CreateLinkResult = { ok: true; link: Link } | { ok: false; reason: "slug_taken" };

export async function createLink(
  db: D1Database,
  input: CreateLinkInput,
): Promise<CreateLinkResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO links (id, slug, destination_url, title, description, og_image_url, owner_user_id, owner_chapter_id, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${LINK_COLS}`,
      )
      .bind(
        newLinkId(),
        input.slug,
        input.destinationUrl,
        input.title ?? null,
        input.description ?? null,
        input.ogImageUrl ?? null,
        input.ownerUserId,
        input.ownerChapterId ?? null,
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

export type UpdateLinkInput = {
  slug?: string;
  destinationUrl?: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  visibility?: LinkVisibility;
};

export async function updateLink(
  db: D1Database,
  id: string,
  input: UpdateLinkInput,
): Promise<Link | null> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
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
  if (input.visibility !== undefined) {
    sets.push("visibility = ?");
    values.push(input.visibility);
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

export async function deleteLink(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM links WHERE id = ?").bind(id).run();
}

// ---------- Tags ----------

export type Tag = {
  id: number;
  name: string;
  color: string | null;
  ownerUserId: string | null;
  ownerChapterId: number | null;
  createdAt: number;
};

type TagRow = {
  id: number;
  name: string;
  color: string | null;
  owner_user_id: string | null;
  owner_chapter_id: number | null;
  created_at: number;
};

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    createdAt: row.created_at,
  };
}

const TAG_COLS = "id, name, color, owner_user_id, owner_chapter_id, created_at";

export async function listTagsForUser(db: D1Database, userId: string): Promise<Tag[]> {
  const { results } = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_user_id = ? ORDER BY name`)
    .bind(userId)
    .all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForChapter(db: D1Database, chapterId: number): Promise<Tag[]> {
  const { results } = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_chapter_id = ? ORDER BY name`)
    .bind(chapterId)
    .all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForLink(db: D1Database, linkId: string): Promise<Tag[]> {
  const cols = TAG_COLS.split(", ")
    .map((c) => `t.${c}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${cols}
       FROM tags t
       JOIN link_tags lt ON lt.tag_id = t.id
       WHERE lt.link_id = ?
       ORDER BY t.name`,
    )
    .bind(linkId)
    .all<TagRow>();
  return results.map(toTag);
}

export type CreateTagInput = {
  name: string;
  color?: string | null;
  ownerUserId?: string | null;
  ownerChapterId?: number | null;
};

export type CreateTagResult = { ok: true; tag: Tag } | { ok: false; reason: "duplicate" };

export async function createTag(db: D1Database, input: CreateTagInput): Promise<CreateTagResult> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO tags (name, color, owner_user_id, owner_chapter_id)
         VALUES (?, ?, ?, ?)
         RETURNING ${TAG_COLS}`,
      )
      .bind(
        input.name,
        input.color ?? null,
        input.ownerUserId ?? null,
        input.ownerChapterId ?? null,
      )
      .first<TagRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function deleteTag(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
}

export type UpdateTagInput = {
  id: number;
  name: string;
  color?: string | null;
};

export type UpdateTagResult = { ok: true; tag: Tag } | { ok: false; reason: "duplicate" };

export async function updateTag(db: D1Database, input: UpdateTagInput): Promise<UpdateTagResult> {
  try {
    const row = await db
      .prepare(
        `UPDATE tags SET name = ?, color = ? WHERE id = ?
         RETURNING ${TAG_COLS}`,
      )
      .bind(input.name, input.color ?? null, input.id)
      .first<TagRow>();
    if (!row) throw new Error("Update returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("CONSTRAINT")) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export type TagWithCount = Tag & { linkCount: number };

type TagWithCountRow = TagRow & { link_count: number };

const TAG_WITH_COUNT_SELECT = `
  SELECT ${TAG_COLS.split(", ")
    .map((c) => `t.${c}`)
    .join(", ")},
    (SELECT COUNT(*) FROM link_tags lt
       JOIN links l ON l.id = lt.link_id
      WHERE lt.tag_id = t.id AND l.deleted_at IS NULL) AS link_count
  FROM tags t
`;

function toTagWithCount(row: TagWithCountRow): TagWithCount {
  return { ...toTag(row), linkCount: row.link_count };
}

export async function listTagsForUserWithCounts(
  db: D1Database,
  userId: string,
): Promise<TagWithCount[]> {
  const { results } = await db
    .prepare(`${TAG_WITH_COUNT_SELECT} WHERE t.owner_user_id = ? ORDER BY t.name`)
    .bind(userId)
    .all<TagWithCountRow>();
  return results.map(toTagWithCount);
}

export async function listTagsForChapterWithCounts(
  db: D1Database,
  chapterId: number,
): Promise<TagWithCount[]> {
  const { results } = await db
    .prepare(`${TAG_WITH_COUNT_SELECT} WHERE t.owner_chapter_id = ? ORDER BY t.name`)
    .bind(chapterId)
    .all<TagWithCountRow>();
  return results.map(toTagWithCount);
}

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

// ---------- Comments ----------

export type Comment = {
  id: number;
  linkId: string;
  authorUserId: string;
  body: string;
  createdAt: number;
};

type CommentRow = {
  id: number;
  link_id: string;
  author_user_id: string;
  body: string;
  created_at: number;
};

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    linkId: row.link_id,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

const COMMENT_COLS = "id, link_id, author_user_id, body, created_at";

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

export type LinkRole = "editor" | "viewer";
export type PrincipalType = "user" | "chapter";

export type LinkPermission = {
  id: number;
  linkId: string;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
  createdAt: number;
};

type LinkPermissionRow = {
  id: number;
  link_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  role: LinkRole;
  created_at: number;
};

export function toLinkPermission(row: LinkPermissionRow): LinkPermission {
  return {
    id: row.id,
    linkId: row.link_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

const PERM_COLS = "id, link_id, principal_type, principal_id, role, created_at";

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

export async function listLinksAccessibleByEmail(
  db: D1Database,
  email: string,
  chapterId: number | null,
): Promise<Link[]> {
  const linkCols = LINK_COLS.split(", ")
    .map((c) => `l.${c}`)
    .join(", ");
  if (chapterId == null) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT ${linkCols}
         FROM links l
         JOIN link_permissions p ON p.link_id = l.id
         WHERE l.deleted_at IS NULL
           AND p.principal_type = 'user' AND p.principal_id = ?
         ORDER BY l.created_at DESC`,
      )
      .bind(email)
      .all<LinkRow>();
    return results.map(toLink);
  }
  const { results } = await db
    .prepare(
      `SELECT DISTINCT ${linkCols}
       FROM links l
       JOIN link_permissions p ON p.link_id = l.id
       WHERE l.deleted_at IS NULL
         AND (
           (p.principal_type = 'user' AND p.principal_id = ?)
           OR (p.principal_type = 'chapter' AND p.principal_id = ?)
         )
       ORDER BY l.created_at DESC`,
    )
    .bind(email, String(chapterId))
    .all<LinkRow>();
  return results.map(toLink);
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

export type UserSummary = { id: string; email: string; name: string };

export async function getUsersByIds(
  db: D1Database,
  ids: string[],
): Promise<Record<string, UserSummary>> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, email, name FROM "user" WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<UserSummary>();
  const out: Record<string, UserSummary> = {};
  for (const u of results) out[u.id] = u;
  return out;
}
