// ---------- Tags ----------

export type Tag = {
  id: number;
  name: string;
  color: string | null;
  ownerUserId: string | null;
  ownerChapterId: number | null;
  createdAt: number;
};

export type TagRow = {
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

export const TAG_COLS = "id, name, color, owner_user_id, owner_chapter_id, created_at";

export type TagWithCount = Tag & { linkCount: number };

export type TagWithCountRow = TagRow & { link_count: number };

export function toTagWithCount(row: TagWithCountRow): TagWithCount {
  return { ...toTag(row), linkCount: row.link_count };
}
