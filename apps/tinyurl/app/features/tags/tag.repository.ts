import type { Tag } from "~/features/tags/tag-record";
import type { TagRow } from "~/features/tags/tag-record";
import { toTag } from "~/features/tags/tag-record";
import { TAG_COLS } from "~/features/tags/tag-record";
import type { TagWithCount } from "~/features/tags/tag-record";
import type { TagWithCountRow } from "~/features/tags/tag-record";
import { toTagWithCount } from "~/features/tags/tag-record";

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

export async function listTagsForLinks(
  db: D1Database,
  linkIds: string[],
): Promise<Record<string, Tag[]>> {
  if (linkIds.length === 0) return {};
  const cols = TAG_COLS.split(", ")
    .map((column) => `t.${column}`)
    .join(", ");
  const { results } = await db
    .prepare(
      `SELECT lt.link_id, ${cols}
       FROM link_tags lt
       JOIN tags t ON t.id = lt.tag_id
       WHERE lt.link_id IN (SELECT value FROM json_each(?))
       ORDER BY t.name`,
    )
    .bind(JSON.stringify(linkIds))
    .all<TagRow & { link_id: string }>();
  const tagsByLinkId: Record<string, Tag[]> = {};
  for (const row of results) {
    const tags = tagsByLinkId[row.link_id] ?? [];
    tags.push(toTag(row));
    tagsByLinkId[row.link_id] = tags;
  }
  return tagsByLinkId;
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

const TAG_WITH_COUNT_SELECT = `
  SELECT ${TAG_COLS.split(", ")
    .map((c) => `t.${c}`)
    .join(", ")},
    (SELECT COUNT(*) FROM link_tags lt
       JOIN links l ON l.id = lt.link_id
      WHERE lt.tag_id = t.id AND l.archived_at IS NULL AND l.deleted_at IS NULL) AS link_count
  FROM tags t
`;

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

export async function getTagById(db: D1Database, id: number): Promise<Tag | null> {
  const row = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE id = ?`)
    .bind(id)
    .first<TagRow>();
  return row ? toTag(row) : null;
}

export async function listTagsForActorPage(
  db: D1Database,
  input: {
    userId: string;
    chapterIds: number[];
    isSuperAdmin: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ tags: Tag[]; nextCursor: string | null }> {
  const visibility = input.isSuperAdmin
    ? "1 = 1"
    : "(owner_user_id = ? OR owner_chapter_id IN (SELECT value FROM json_each(?)))";
  const values: (string | number)[] = input.isSuperAdmin
    ? []
    : [input.userId, JSON.stringify(input.chapterIds)];
  const { results } = await db
    .prepare(`SELECT ${TAG_COLS} FROM tags WHERE ${visibility} ORDER BY name, id LIMIT ? OFFSET ?`)
    .bind(...values, input.limit + 1, input.offset)
    .all<TagRow>();
  const tags = results.map(toTag);
  return {
    tags: tags.slice(0, input.limit),
    nextCursor: tags.length > input.limit ? btoa(String(input.offset + input.limit)) : null,
  };
}
