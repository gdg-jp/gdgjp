import type { UserChapter } from "@gdgjp/gdg-lib";

export type XAccount = {
  id: string;
  chapterId: number;
  xUserId: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string | null;
  accessTokenExpiresAt: string | null;
  authorizedByUserId: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type PostStatus =
  | "scheduled"
  | "waiting_for_photo"
  | "posting"
  | "published"
  | "failed"
  | "needs_confirmation";

export type Post = {
  id: string;
  chapterId: number;
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: "scheduled" | "photo_required";
  status: PostStatus;
  createdByUserId: string;
  publishedXPostId: string | null;
  publishedAt: string | null;
  failureReason: string | null;
  linkPreviewUrl: string | null;
  linkPreviewTitle: string | null;
  linkPreviewDescription: string | null;
  linkPreviewImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostMedia = {
  id: string;
  postId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  altText: string;
  sortOrder: number;
  createdAt: string;
};

export type GooglePhotosAlbum = {
  id: string;
  chapterId: number;
  albumUrl: string;
  enabled: boolean;
  pollIntervalMinutes: number;
  unchangedPollCount: number;
  nextPollAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type GooglePhotosLibraryMedia = {
  id: string;
  stablePhotoId: string;
  contentType: string;
  byteSize: number;
  takenAt: string | null;
  importedAt: string;
};

export type GooglePhotosPollRun = {
  id: string;
  startedAt: string;
  outcome: string;
  importedCount: number;
  detail: string | null;
};

type ContributorRow = { chapter_id: number };

export async function contributorChapterIds(db: D1Database, email: string): Promise<number[]> {
  const result = await db
    .prepare("SELECT chapter_id FROM sns_contributors WHERE user_email = ?")
    .bind(email)
    .all<ContributorRow>();
  return result.results.map((row) => row.chapter_id);
}

export async function listAccessibleChapters(
  db: D1Database,
  email: string,
  memberships: UserChapter[],
): Promise<
  { chapterId: number; chapterSlug: string; role: "organizer" | "member" | "contributor" }[]
> {
  const contributorIds = new Set(await contributorChapterIds(db, email));
  const chapters: {
    chapterId: number;
    chapterSlug: string;
    role: "organizer" | "member" | "contributor";
  }[] = memberships.map((chapter) => ({ ...chapter }));
  for (const chapterId of contributorIds) {
    if (!chapters.some((chapter) => chapter.chapterId === chapterId)) {
      chapters.push({ chapterId, chapterSlug: `chapter-${chapterId}`, role: "contributor" });
    }
  }
  return chapters.filter(
    (chapter) => chapter.role === "organizer" || contributorIds.has(chapter.chapterId),
  );
}

export async function isContributor(
  db: D1Database,
  chapterId: number,
  email: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM sns_contributors WHERE chapter_id = ? AND user_email = ?")
    .bind(chapterId, email)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function listXAccounts(db: D1Database, chapterId: number): Promise<XAccount[]> {
  const result = await db
    .prepare(
      `SELECT id, chapter_id, x_user_id, username, display_name, profile_image_url,
              access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
              authorized_by_user_id, created_at, updated_at, revoked_at
       FROM x_accounts WHERE chapter_id = ? AND revoked_at IS NULL ORDER BY username COLLATE NOCASE`,
    )
    .bind(chapterId)
    .all<XAccountRow>();
  return result.results.map(xAccountFromRow);
}

type XAccountRow = {
  id: string;
  chapter_id: number;
  x_user_id: string;
  username: string;
  display_name: string;
  profile_image_url: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  authorized_by_user_id: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};
function xAccountFromRow(row: XAccountRow): XAccount {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    xUserId: row.x_user_id,
    username: row.username,
    displayName: row.display_name,
    profileImageUrl: row.profile_image_url,
    accessTokenCiphertext: row.access_token_ciphertext,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    accessTokenExpiresAt: row.access_token_expires_at,
    authorizedByUserId: row.authorized_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  };
}

export async function getXAccount(db: D1Database, id: string): Promise<XAccount | null> {
  const row = await db
    .prepare(
      `SELECT id, chapter_id, x_user_id, username, display_name, profile_image_url,
            access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
            authorized_by_user_id, created_at, updated_at, revoked_at FROM x_accounts WHERE id = ?`,
    )
    .bind(id)
    .first<XAccountRow>();
  return row ? xAccountFromRow(row) : null;
}

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

type GooglePhotosAlbumRow = {
  id: string;
  chapter_id: number;
  album_url: string;
  enabled: number;
  poll_interval_minutes: number;
  unchanged_poll_count: number;
  next_poll_at: string;
  last_success_at: string | null;
  last_error: string | null;
};

function googlePhotosAlbumFromRow(row: GooglePhotosAlbumRow): GooglePhotosAlbum {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    albumUrl: row.album_url,
    enabled: row.enabled === 1,
    pollIntervalMinutes: row.poll_interval_minutes,
    unchangedPollCount: row.unchanged_poll_count,
    nextPollAt: row.next_poll_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
  };
}

export async function getGooglePhotosAlbum(
  db: D1Database,
  chapterId: number,
): Promise<GooglePhotosAlbum | null> {
  const row = await db
    .prepare("SELECT * FROM google_photos_albums WHERE chapter_id = ?")
    .bind(chapterId)
    .first<GooglePhotosAlbumRow>();
  return row ? googlePhotosAlbumFromRow(row) : null;
}

export async function listGooglePhotosLibraryMedia(
  db: D1Database,
  chapterId: number,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ media: GooglePhotosLibraryMedia[]; nextCursor: string | null }> {
  const limit = options.limit ?? 48;
  const cursor = options.cursor ? parseGooglePhotosLibraryCursor(options.cursor) : null;
  const cursorClause = cursor
    ? `AND (COALESCE(m.taken_at, m.imported_at) < ?
        OR (COALESCE(m.taken_at, m.imported_at) = ? AND m.id < ?))`
    : "";
  const result = await db
    .prepare(
      `SELECT m.id, m.stable_photo_id, m.content_type, m.byte_size, m.taken_at, m.imported_at
       FROM google_photos_media m
       JOIN google_photos_albums a ON a.id = m.album_id
       WHERE a.chapter_id = ?
       ${cursorClause}
       ORDER BY COALESCE(m.taken_at, m.imported_at) DESC, m.id DESC
       LIMIT ?`,
    )
    .bind(chapterId, ...(cursor ? [cursor.date, cursor.date, cursor.id] : []), limit + 1)
    .all<{
      id: string;
      stable_photo_id: string;
      content_type: string;
      byte_size: number;
      taken_at: string | null;
      imported_at: string;
    }>();
  const rows = result.results.slice(0, limit);
  const last = rows.at(-1);
  return {
    media: rows.map((row) => ({
      id: row.id,
      stablePhotoId: row.stable_photo_id,
      contentType: row.content_type,
      byteSize: row.byte_size,
      takenAt: row.taken_at,
      importedAt: row.imported_at,
    })),
    nextCursor:
      result.results.length > limit && last
        ? JSON.stringify({ date: last.taken_at ?? last.imported_at, id: last.id })
        : null,
  };
}

function parseGooglePhotosLibraryCursor(cursor: string): { date: string; id: string } | null {
  try {
    const value = JSON.parse(cursor) as { date?: unknown; id?: unknown };
    return typeof value.date === "string" && typeof value.id === "string"
      ? { date: value.date, id: value.id }
      : null;
  } catch {
    return null;
  }
}

export async function listGooglePhotosPollRuns(
  db: D1Database,
  chapterId: number,
): Promise<GooglePhotosPollRun[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.started_at, r.outcome, r.imported_count, r.detail
       FROM google_photos_poll_runs r
       JOIN google_photos_albums a ON a.id = r.album_id
       WHERE a.chapter_id = ? ORDER BY r.started_at DESC LIMIT 5`,
    )
    .bind(chapterId)
    .all<{
      id: string;
      started_at: string;
      outcome: string;
      imported_count: number;
      detail: string | null;
    }>();
  return result.results.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    outcome: row.outcome,
    importedCount: row.imported_count,
    detail: row.detail,
  }));
}

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

export async function listContributors(
  db: D1Database,
  chapterId: number,
): Promise<{ email: string; createdAt: string }[]> {
  const result = await db
    .prepare(
      "SELECT user_email, created_at FROM sns_contributors WHERE chapter_id = ? ORDER BY user_email COLLATE NOCASE",
    )
    .bind(chapterId)
    .all<{ user_email: string; created_at: string }>();
  return result.results.map((row) => ({ email: row.user_email, createdAt: row.created_at }));
}
