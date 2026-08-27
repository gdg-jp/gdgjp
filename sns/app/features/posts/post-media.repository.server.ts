import type { PostMedia } from "~/lib/db.server";
import { listPostMedia } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
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
): Promise<PostMedia> {
  const createdAt = nowIso();
  await db
    .prepare(
      "INSERT INTO post_media (id, post_id, r2_key, content_type, byte_size, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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
  return { ...record, createdAt };
}

export async function deletePostMediaById(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM post_media WHERE id = ?").bind(id).run();
}

/**
 * Reorders (and re-labels) several media rows in one D1 batch so the
 * `UNIQUE (post_id, sort_order)` positions can never be left half-updated.
 */
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
