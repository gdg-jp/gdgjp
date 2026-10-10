import type { Invite, InviteChapter, InviteSummary } from "./types";

type InviteRow = {
  id: string;
  token: string;
  created_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  creator_name: string | null;
  creator_email: string | null;
};

type InviteChapterRow = { invite_id: string; id: number; slug: string; name: string };

const INVITE_COLS = `i.id, i.token, i.created_by, i.created_at, i.expires_at, i.revoked_at,
  u.name AS creator_name, u.email AS creator_email`;

function toInviteSummary(row: InviteRow, chapters: InviteChapter[]): InviteSummary {
  return {
    id: row.id,
    token: row.token,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    chapters,
    creator:
      row.creator_email !== null
        ? { name: row.creator_name ?? "", email: row.creator_email }
        : null,
  };
}

async function chaptersByInvite(
  db: D1Database,
  inviteIds: string[],
): Promise<Map<string, InviteChapter[]>> {
  const grouped = new Map<string, InviteChapter[]>();
  if (inviteIds.length === 0) return grouped;
  const { results } = await db
    .prepare(
      `SELECT ic.invite_id, c.id, c.slug, c.name
       FROM chapter_invite_chapters ic
       JOIN chapters c ON c.id = ic.chapter_id
       WHERE ic.invite_id IN (${inviteIds.map(() => "?").join(", ")})
       ORDER BY c.name`,
    )
    .bind(...inviteIds)
    .all<InviteChapterRow>();
  for (const { invite_id, id, slug, name } of results) {
    const list = grouped.get(invite_id) ?? [];
    list.push({ id, slug, name });
    grouped.set(invite_id, list);
  }
  return grouped;
}

export async function createInvite(
  db: D1Database,
  input: { id: string; token: string; createdBy: string; chapterIds: number[]; expiresAt: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO chapter_invites (id, token, created_by, expires_at) VALUES (?, ?, ?, ?)",
      )
      .bind(input.id, input.token, input.createdBy, input.expiresAt),
    ...input.chapterIds.map((chapterId) =>
      db
        .prepare("INSERT INTO chapter_invite_chapters (invite_id, chapter_id) VALUES (?, ?)")
        .bind(input.id, chapterId),
    ),
  ]);
}

export async function getInviteByToken(db: D1Database, token: string): Promise<Invite | null> {
  const row = await db
    .prepare(
      `SELECT ${INVITE_COLS}
       FROM chapter_invites i
       LEFT JOIN "user" u ON u.id = i.created_by
       WHERE i.token = ?`,
    )
    .bind(token)
    .first<InviteRow>();
  if (!row) return null;
  const chapters = await chaptersByInvite(db, [row.id]);
  return toInviteSummary(row, chapters.get(row.id) ?? []);
}

export async function getInviteById(db: D1Database, id: string): Promise<Invite | null> {
  const row = await db
    .prepare(
      `SELECT ${INVITE_COLS}
       FROM chapter_invites i
       LEFT JOIN "user" u ON u.id = i.created_by
       WHERE i.id = ?`,
    )
    .bind(id)
    .first<InviteRow>();
  if (!row) return null;
  const chapters = await chaptersByInvite(db, [row.id]);
  return toInviteSummary(row, chapters.get(row.id) ?? []);
}

/** Usable (unrevoked, unexpired) invites touching any of the given chapters, newest first. */
export async function listActiveInvitesForChapters(
  db: D1Database,
  chapterIds: number[],
  nowSeconds: number,
): Promise<InviteSummary[]> {
  if (chapterIds.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT ${INVITE_COLS}
       FROM chapter_invites i
       LEFT JOIN "user" u ON u.id = i.created_by
       WHERE i.revoked_at IS NULL AND i.expires_at > ?
         AND EXISTS (
           SELECT 1 FROM chapter_invite_chapters ic
           WHERE ic.invite_id = i.id
             AND ic.chapter_id IN (${chapterIds.map(() => "?").join(", ")})
         )
       ORDER BY i.created_at DESC, i.id`,
    )
    .bind(nowSeconds, ...chapterIds)
    .all<InviteRow>();
  const chapters = await chaptersByInvite(
    db,
    results.map((row) => row.id),
  );
  return results.map((row) => toInviteSummary(row, chapters.get(row.id) ?? []));
}

export async function revokeInvite(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(
      "UPDATE chapter_invites SET revoked_at = unixepoch() WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(id)
    .run();
}
