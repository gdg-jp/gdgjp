import type { Contributor } from "./contributor.types";

/**
 * `sns_contributors` has a composite primary key `(chapter_id, user_email)` and
 * `user_email` is `COLLATE NOCASE`, so every lookup, insert conflict, and delete
 * here compares the address case-insensitively.
 */
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

export async function listContributors(db: D1Database, chapterId: number): Promise<Contributor[]> {
  const result = await db
    .prepare(
      "SELECT user_email, created_at FROM sns_contributors WHERE chapter_id = ? ORDER BY user_email COLLATE NOCASE",
    )
    .bind(chapterId)
    .all<{ user_email: string; created_at: string }>();
  return result.results.map((row) => ({ email: row.user_email, createdAt: row.created_at }));
}

/**
 * Offset-paginated contributor list. Fetches one extra row (`LIMIT limit + 1`)
 * so the caller can tell whether another page exists without a second query.
 */
export async function listContributorsPage(
  db: D1Database,
  options: { chapterId: number; limit: number; offset: number },
): Promise<{ contributors: Contributor[]; hasMore: boolean }> {
  const result = await db
    .prepare(
      "SELECT user_email, created_at FROM sns_contributors WHERE chapter_id = ? ORDER BY user_email COLLATE NOCASE LIMIT ? OFFSET ?",
    )
    .bind(options.chapterId, options.limit + 1, options.offset)
    .all<{ user_email: string; created_at: string }>();
  const rows = result.results.slice(0, options.limit);
  return {
    contributors: rows.map((row) => ({ email: row.user_email, createdAt: row.created_at })),
    hasMore: result.results.length > options.limit,
  };
}

export type InsertContributorRecord = {
  chapterId: number;
  userEmail: string;
  grantedByUserId: string;
  now: string;
};

/**
 * Idempotent add: a row that already exists (case-insensitively) is left
 * untouched rather than raising or overwriting `granted_by_user_id`.
 */
export async function insertContributor(
  db: D1Database,
  record: InsertContributorRecord,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO sns_contributors (chapter_id, user_email, granted_by_user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(chapter_id, user_email) DO NOTHING",
    )
    .bind(record.chapterId, record.userEmail, record.grantedByUserId, record.now)
    .run();
}

export async function deleteContributor(
  db: D1Database,
  chapterId: number,
  userEmail: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM sns_contributors WHERE chapter_id = ? AND user_email = ?")
    .bind(chapterId, userEmail)
    .run();
}
