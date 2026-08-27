import type { PostStatus } from "~/lib/db.server";
import { getPost, listPostsPage } from "~/lib/db.server";
import { nowIso } from "~/lib/utils";
import type { PostCondition } from "./post.types";

export { getPost, listPostsPage };

type PersistedLinkPreview = {
  url: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

export type InsertPostRecord = {
  id: string;
  chapterId: number;
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: PostCondition;
  status: PostStatus;
  createdByUserId: string;
  linkPreview: PersistedLinkPreview;
  now: string;
};

export async function insertPost(db: D1Database, record: InsertPostRecord): Promise<void> {
  await db
    .prepare(
      "INSERT INTO posts (id, chapter_id, x_account_id, text, scheduled_at, condition, status, created_by_user_id, link_preview_url, link_preview_title, link_preview_description, link_preview_image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      record.id,
      record.chapterId,
      record.xAccountId,
      record.text,
      record.scheduledAt,
      record.condition,
      record.status,
      record.createdByUserId,
      record.linkPreview.url,
      record.linkPreview.title,
      record.linkPreview.description,
      record.linkPreview.imageUrl,
      record.now,
      record.now,
    )
    .run();
}

export type UpdatePostFieldsRecord = {
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: PostCondition;
  status: PostStatus;
  linkPreview: PersistedLinkPreview;
  now: string;
};

/** Mirrors the dashboard's save: also clears any prior failure reason. */
export async function updatePostFields(
  db: D1Database,
  id: string,
  record: UpdatePostFieldsRecord,
): Promise<void> {
  await db
    .prepare(
      "UPDATE posts SET x_account_id = ?, text = ?, scheduled_at = ?, condition = ?, status = ?, link_preview_url = ?, link_preview_title = ?, link_preview_description = ?, link_preview_image_url = ?, updated_at = ?, failure_reason = NULL WHERE id = ?",
    )
    .bind(
      record.xAccountId,
      record.text,
      record.scheduledAt,
      record.condition,
      record.status,
      record.linkPreview.url,
      record.linkPreview.title,
      record.linkPreview.description,
      record.linkPreview.imageUrl,
      record.now,
      id,
    )
    .run();
}

/** Recompute-only status write; never disturbs a `published`/`posting` row. */
export async function updatePostStatus(
  db: D1Database,
  id: string,
  status: PostStatus,
): Promise<void> {
  await db
    .prepare(
      "UPDATE posts SET status = ?, updated_at = ? WHERE id = ? AND status NOT IN ('published', 'posting')",
    )
    .bind(status, nowIso(), id)
    .run();
}

export async function deletePostRow(db: D1Database, id: string): Promise<number> {
  const result = await db
    .prepare("DELETE FROM posts WHERE id = ? AND status NOT IN ('published', 'posting')")
    .bind(id)
    .run();
  return result.meta.changes;
}

export async function replacePostMediaTags(
  db: D1Database,
  postId: string,
  tags: { xUserId: string; username: string }[],
): Promise<void> {
  await db.prepare("DELETE FROM post_media_tags WHERE post_id = ?").bind(postId).run();
  for (const tag of tags) {
    await db
      .prepare("INSERT INTO post_media_tags (post_id, x_user_id, username) VALUES (?, ?, ?)")
      .bind(postId, tag.xUserId, tag.username)
      .run();
  }
}
