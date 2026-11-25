import { nowIso } from "~/lib/utils";
import type { PostMedia } from "./post.types";
import type { MediaMetadataEdit } from "./post.types";

type PostMediaRow = {
  id: string;
  post_id: string;
  r2_key: string;
  content_type: string;
  byte_size: number;
  alt_text: string;
  sort_order: number;
  created_at: string;
};

function toPostMedia(row: PostMediaRow): PostMedia {
  return {
    id: row.id,
    postId: row.post_id,
    r2Key: row.r2_key,
    contentType: row.content_type,
    byteSize: row.byte_size,
    altText: row.alt_text,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function listMediaForPost(db: D1Database, postId: string): Promise<PostMedia[]> {
  return (await listPostMedia(db, [postId]))[postId] ?? [];
}

export async function getPostMediaById(db: D1Database, id: string): Promise<PostMedia | null> {
  const row = await db
    .prepare(
      "SELECT id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at FROM post_media WHERE id = ?",
    )
    .bind(id)
    .first<PostMediaRow>();
  return row ? toPostMedia(row) : null;
}

export type InsertPostMediaRecord = {
  id: string;
  postId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  altText: string;
  sortOrder: number;
};

export async function insertPostMedia(
  db: D1Database,
  record: InsertPostMediaRecord,
): Promise<PostMedia | null> {
  const createdAt = nowIso();
  const result = await db
    .prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (post_id, sort_order) DO NOTHING",
    )
    .bind(
      record.id,
      record.postId,
      record.r2Key,
      record.contentType,
      record.byteSize,
      record.altText,
      record.sortOrder,
      createdAt,
    )
    .run();
  return result.meta.changes > 0 ? { ...record, createdAt } : null;
}

export async function deletePostMediaById(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM post_media WHERE id = ?").bind(id).run();
}

export async function batchUpdateMediaMetadata(
  db: D1Database,
  edits: MediaMetadataEdit[],
): Promise<void> {
  if (edits.length === 0) return;
  await db.batch(
    edits.map((edit) =>
      db
        .prepare("UPDATE post_media SET alt_text = ?, sort_order = ? WHERE id = ?")
        .bind(edit.altText, edit.sortOrder, edit.id),
    ),
  );
}

export async function listPostMedia(
  db: D1Database,
  postIds: string[],
): Promise<Record<string, PostMedia[]>> {
  if (postIds.length === 0) return {};
  const placeholders = postIds.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at FROM post_media WHERE post_id IN (${placeholders}) ORDER BY sort_order`,
    )
    .bind(...postIds)
    .all<PostMediaRow>();
  const byPost: Record<string, PostMedia[]> = {};
  for (const row of result.results) {
    const values = byPost[row.post_id] ?? [];
    values.push({
      id: row.id,
      postId: row.post_id,
      r2Key: row.r2_key,
      contentType: row.content_type,
      byteSize: row.byte_size,
      altText: row.alt_text,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    });
    byPost[row.post_id] = values;
  }
  return byPost;
}
