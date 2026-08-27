import type { Tag, TagWithCount } from "~/lib/db";

type TagRow = {
  id: number;
  name: string;
  color: string | null;
  owner_user_id: string | null;
  owner_chapter_id: number | null;
  created_at: number;
};

const TAG_COLS = "id, name, color, owner_user_id, owner_chapter_id, created_at";

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    createdAt: row.created_at,
  };
}

export async function getTagById(db: D1Database, id: number): Promise<Tag | null> {
  const row = await db.prepare(`SELECT ${TAG_COLS} FROM tags WHERE id = ?`).bind(id).first<TagRow>();
  return row ? toTag(row) : null;
}

export async function listTagsForUser(db: D1Database, userId: string): Promise<Tag[]> {
  const { results } = await db.prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_user_id = ? ORDER BY name`).bind(userId).all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForChapter(db: D1Database, chapterId: number): Promise<Tag[]> {
  const { results } = await db.prepare(`SELECT ${TAG_COLS} FROM tags WHERE owner_chapter_id = ? ORDER BY name`).bind(chapterId).all<TagRow>();
  return results.map(toTag);
}

export async function listTagsForActorPage(
  db: D1Database,
  input: { userId: string; chapterIds: number[]; isSuperAdmin: boolean; limit: number; offset: number },
): Promise<{ tags: Tag[]; nextCursor: string | null }> {
  const visibility = input.isSuperAdmin
    ? "1 = 1"
    : "(owner_user_id = ? OR owner_chapter_id IN (SELECT value FROM json_each(?)))";
  const values: (string | number)[] = input.isSuperAdmin
    ? []
    : [input.userId, JSON.stringify(input.chapterIds)];
  const { results } = await db.prepare(`SELECT ${TAG_COLS} FROM tags WHERE ${visibility} ORDER BY name, id LIMIT ? OFFSET ?`).bind(...values, input.limit + 1, input.offset).all<TagRow>();
  const tags = results.map(toTag);
  return { tags: tags.slice(0, input.limit), nextCursor: tags.length > input.limit ? btoa(String(input.offset + input.limit)) : null };
}

export type CreateTagInput = { name: string; color?: string | null; ownerUserId?: string | null; ownerChapterId?: number | null };
export type TagMutationResult = { ok: true; tag: Tag } | { ok: false; reason: "duplicate" };

export async function createTag(db: D1Database, input: CreateTagInput): Promise<TagMutationResult> {
  try {
    const row = await db.prepare(`INSERT INTO tags (name, color, owner_user_id, owner_chapter_id) VALUES (?, ?, ?, ?) RETURNING ${TAG_COLS}`).bind(input.name, input.color ?? null, input.ownerUserId ?? null, input.ownerChapterId ?? null).first<TagRow>();
    if (!row) throw new Error("Insert returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("CONSTRAINT")) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function updateTag(db: D1Database, input: { id: number; name: string; color?: string | null }): Promise<TagMutationResult> {
  try {
    const row = await db.prepare(`UPDATE tags SET name = ?, color = ? WHERE id = ? RETURNING ${TAG_COLS}`).bind(input.name, input.color ?? null, input.id).first<TagRow>();
    if (!row) throw new Error("Update returned no row");
    return { ok: true, tag: toTag(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE") || message.includes("CONSTRAINT")) return { ok: false, reason: "duplicate" };
    throw error;
  }
}

export async function deleteTag(db: D1Database, id: number): Promise<void> { await db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run(); }

async function listWithCounts(db: D1Database, clause: string, value: string | number): Promise<TagWithCount[]> {
  const { results } = await db.prepare(`SELECT ${TAG_COLS.split(", ").map((c) => `t.${c}`).join(", ")}, (SELECT COUNT(*) FROM link_tags lt JOIN links l ON l.id = lt.link_id WHERE lt.tag_id = t.id AND l.archived_at IS NULL AND l.deleted_at IS NULL) AS link_count FROM tags t WHERE ${clause} ORDER BY t.name`).bind(value).all<TagRow & { link_count: number }>();
  return results.map((row) => ({ ...toTag(row), linkCount: row.link_count }));
}
export function listTagsForUserWithCounts(db: D1Database, userId: string) { return listWithCounts(db, "t.owner_user_id = ?", userId); }
export function listTagsForChapterWithCounts(db: D1Database, chapterId: number) { return listWithCounts(db, "t.owner_chapter_id = ?", chapterId); }
