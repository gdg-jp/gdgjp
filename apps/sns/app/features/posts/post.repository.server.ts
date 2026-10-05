import { nowIso } from "~/lib/utils";
import type { Post, PostStatus } from "./post.types";
import type { PostCondition } from "./post.types";

type PostRow = {
  id: string;
  chapter_id: number;
  x_account_id: string;
  text: string;
  scheduled_at: string;
  condition: "scheduled" | "photo_required";
  status: PostStatus;
  created_by_user_id: string;
  published_x_post_id: string | null;
  published_at: string | null;
  failure_reason: string | null;
  link_preview_url: string | null;
  link_preview_title: string | null;
  link_preview_description: string | null;
  link_preview_image_url: string | null;
  created_at: string;
  updated_at: string;
};
function postFromRow(row: PostRow): Post {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    xAccountId: row.x_account_id,
    text: row.text,
    scheduledAt: row.scheduled_at,
    condition: row.condition,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    publishedXPostId: row.published_x_post_id,
    publishedAt: row.published_at,
    failureReason: row.failure_reason,
    linkPreviewUrl: row.link_preview_url,
    linkPreviewTitle: row.link_preview_title,
    linkPreviewDescription: row.link_preview_description,
    linkPreviewImageUrl: row.link_preview_image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPosts(db: D1Database, chapterId: number): Promise<Post[]> {
  const result = await db
    .prepare(
      "SELECT * FROM posts WHERE chapter_id = ? AND status != 'published' ORDER BY scheduled_at ASC, created_at ASC",
    )
    .bind(chapterId)
    .all<PostRow>();
  return result.results.map(postFromRow);
}

export async function getPost(db: D1Database, id: string): Promise<Post | null> {
  const row = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<PostRow>();
  return row ? postFromRow(row) : null;
}

/**
 * Offset-paginated post list for a chapter, optionally filtered to one status.
 * Fetches one extra row so the caller can tell whether another page exists.
 * Unlike {@link listPosts}, this does not exclude `published` posts — the CLI
 * uses it to inspect a chapter's whole schedule, filtering by `status` itself.
 */
export async function listPostsPage(
  db: D1Database,
  options: { chapterId: number; status?: PostStatus; limit: number; offset: number },
): Promise<{ posts: Post[]; hasMore: boolean }> {
  const clauses = ["chapter_id = ?"];
  const binds: unknown[] = [options.chapterId];
  if (options.status) {
    clauses.push("status = ?");
    binds.push(options.status);
  }
  const result = await db
    .prepare(
      `SELECT * FROM posts WHERE ${clauses.join(" AND ")}
       ORDER BY scheduled_at ASC, created_at ASC, id ASC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, options.limit + 1, options.offset)
    .all<PostRow>();
  const rows = result.results.slice(0, options.limit);
  return { posts: rows.map(postFromRow), hasMore: result.results.length > options.limit };
}

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
