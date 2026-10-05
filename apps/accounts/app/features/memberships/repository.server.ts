import {
  MEMBERSHIP_JOIN_COLS,
  type MembershipJoinRow,
  type MembershipRow,
  toMembership,
  toMembershipWithChapter,
} from "./rows.server";
import type {
  Membership,
  MembershipWithChapter,
  PendingRequestWithChapter,
  UserChapter,
} from "./types";

/**
 * Returns the user's membership in a specific chapter, or null.
 * With the multi-chapter schema this is the canonical single-membership lookup.
 */
export async function getMembership(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<MembershipWithChapter | null> {
  const row = await db
    .prepare(
      `SELECT ${MEMBERSHIP_JOIN_COLS}
       FROM memberships m
       JOIN chapters c ON c.id = m.chapter_id
       WHERE m.user_id = ? AND m.chapter_id = ?`,
    )
    .bind(userId, chapterId)
    .first<MembershipJoinRow>();
  return row ? toMembershipWithChapter(row) : null;
}

/**
 * All memberships for a user, sorted: active before pending,
 * organizer before member, then oldest approved/created first.
 */
export async function listMembershipsForUser(
  db: D1Database,
  userId: string,
): Promise<MembershipWithChapter[]> {
  const { results } = await db
    .prepare(
      `SELECT ${MEMBERSHIP_JOIN_COLS}
       FROM memberships m
       JOIN chapters c ON c.id = m.chapter_id
       WHERE m.user_id = ?
       ORDER BY
         CASE m.status WHEN 'active' THEN 0 ELSE 1 END,
         CASE m.role   WHEN 'organizer' THEN 0 ELSE 1 END,
         COALESCE(m.approved_at, m.created_at),
         m.chapter_id`,
    )
    .bind(userId)
    .all<MembershipJoinRow>();
  return results.map(toMembershipWithChapter);
}

/**
 * Picks a "primary" active chapter for JWT claims (organizer beats member,
 * then oldest approved first). Returns null if the user has no active membership.
 */
export async function getChapterByUserId(
  db: D1Database,
  userId: string,
): Promise<UserChapter | null> {
  const row = await db
    .prepare(
      `SELECT m.chapter_id AS chapterId, c.slug AS chapterSlug, m.role AS role
       FROM memberships m
       JOIN chapters c ON c.id = m.chapter_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY
         CASE m.role WHEN 'organizer' THEN 0 ELSE 1 END,
         COALESCE(m.approved_at, m.created_at),
         m.chapter_id
       LIMIT 1`,
    )
    .bind(userId)
    .first<UserChapter>();
  return row ?? null;
}

export async function listActiveChaptersForUser(
  db: D1Database,
  userId: string,
): Promise<UserChapter[]> {
  const { results } = await db
    .prepare(
      `SELECT m.chapter_id AS chapterId, c.slug AS chapterSlug, m.role AS role
       FROM memberships m
       JOIN chapters c ON c.id = m.chapter_id
       WHERE m.user_id = ? AND m.status = 'active'
       ORDER BY
         CASE m.role WHEN 'organizer' THEN 0 ELSE 1 END,
         COALESCE(m.approved_at, m.created_at),
         m.chapter_id`,
    )
    .bind(userId)
    .all<UserChapter>();
  return results;
}

export async function listPendingForChapter(
  db: D1Database,
  chapterId: number,
): Promise<Membership[]> {
  const { results } = await db
    .prepare(
      "SELECT user_id, chapter_id, role, status, created_at, approved_at FROM memberships WHERE chapter_id = ? AND status = 'pending' ORDER BY created_at",
    )
    .bind(chapterId)
    .all<MembershipRow>();
  return results.map(toMembership);
}

export async function listMembersForChapter(
  db: D1Database,
  chapterId: number,
): Promise<Membership[]> {
  const { results } = await db
    .prepare(
      "SELECT user_id, chapter_id, role, status, created_at, approved_at FROM memberships WHERE chapter_id = ? AND status = 'active' ORDER BY role DESC, created_at",
    )
    .bind(chapterId)
    .all<MembershipRow>();
  return results.map(toMembership);
}

/**
 * Cross-chapter list of pending requests, joined with chapter and requester info.
 * Used by the super-admin /admin/requests page.
 */
export async function listAllPendingRequests(db: D1Database): Promise<PendingRequestWithChapter[]> {
  const { results } = await db
    .prepare(
      `SELECT
         m.user_id, m.chapter_id, m.role, m.status, m.created_at, m.approved_at,
         c.id AS c_id, c.slug AS c_slug, c.name AS c_name, c.kind AS c_kind,
         c.region AS c_region, c.created_at AS c_created_at,
         u.id AS u_id, u.email AS u_email, u.name AS u_name
       FROM memberships m
       JOIN chapters c ON c.id = m.chapter_id
       JOIN "user" u   ON u.id = m.user_id
       WHERE m.status = 'pending'
       ORDER BY m.created_at`,
    )
    .all<MembershipJoinRow & { u_id: string; u_email: string; u_name: string }>();
  return results.map((row) => ({
    ...toMembership(row),
    chapter: {
      id: row.c_id,
      slug: row.c_slug,
      name: row.c_name,
      kind: row.c_kind,
      region: row.c_region,
      createdAt: row.c_created_at,
    },
    user: { id: row.u_id, email: row.u_email, name: row.u_name },
  }));
}

export async function countActiveOrganizers(db: D1Database, chapterId: number): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM memberships WHERE chapter_id = ? AND status = 'active' AND role = 'organizer'",
    )
    .bind(chapterId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getOrganizerEmailsForChapter(
  db: D1Database,
  chapterId: number,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT u.email AS email
       FROM memberships m
       JOIN "user" u ON u.id = m.user_id
       WHERE m.chapter_id = ? AND m.status = 'active' AND m.role = 'organizer'`,
    )
    .bind(chapterId)
    .all<{ email: string }>();
  return results.map((r) => r.email).filter(Boolean);
}
