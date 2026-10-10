import { getChapterById } from "~/features/chapters/repository.server";
import { getMembership } from "./repository.server";
import type { Membership, Role } from "./types";

export type RequestMembershipResult =
  | { ok: true }
  | { ok: false; reason: "already_in_chapter" | "chapter_not_found" };

export async function requestMembership(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<RequestMembershipResult> {
  const chapter = await getChapterById(db, chapterId);
  if (!chapter) return { ok: false, reason: "chapter_not_found" };
  const existing = await db
    .prepare("SELECT user_id FROM memberships WHERE user_id = ? AND chapter_id = ?")
    .bind(userId, chapterId)
    .first<{ user_id: string }>();
  if (existing) return { ok: false, reason: "already_in_chapter" };
  try {
    await db
      .prepare(
        "INSERT INTO memberships (user_id, chapter_id, role, status) VALUES (?, ?, 'member', 'pending')",
      )
      .bind(userId, chapterId)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code ?? "";
    const looksLikeConstraint =
      msg.includes("UNIQUE") || msg.includes("CONSTRAINT") || code === "SQLITE_CONSTRAINT";
    if (looksLikeConstraint) {
      // Confirm it's the (user_id, chapter_id) PK collision rather than a FK or
      // CHECK failure (e.g., chapter deleted between the pre-check and INSERT).
      const dup = await db
        .prepare("SELECT 1 AS ok FROM memberships WHERE user_id = ? AND chapter_id = ?")
        .bind(userId, chapterId)
        .first<{ ok: number }>();
      if (dup) return { ok: false, reason: "already_in_chapter" };
    }
    throw err;
  }
  return { ok: true };
}

export type InviteJoinResult = "joined" | "already_member";

/**
 * Joins a chapter through an organizer-issued invite: no approval step. A
 * pending request is promoted to active; an existing active membership keeps
 * its role (an organizer opening their own link is not demoted).
 */
export async function joinMembershipViaInvite(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<InviteJoinResult> {
  const result = await db
    .prepare(
      `INSERT INTO memberships (user_id, chapter_id, role, status, approved_at)
       VALUES (?, ?, 'member', 'active', unixepoch())
       ON CONFLICT(user_id, chapter_id) DO UPDATE
         SET status = 'active', approved_at = unixepoch()
         WHERE memberships.status = 'pending'`,
    )
    .bind(userId, chapterId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0 ? "joined" : "already_member";
}

export async function approveMembership(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE memberships SET status = 'active', approved_at = unixepoch() WHERE user_id = ? AND chapter_id = ? AND status = 'pending'",
    )
    .bind(userId, chapterId)
    .run();
}

export async function revertApproveMembership(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE memberships SET status = 'pending', approved_at = NULL WHERE user_id = ? AND chapter_id = ? AND status = 'active'",
    )
    .bind(userId, chapterId)
    .run();
}

export async function restoreMembership(db: D1Database, m: Membership): Promise<void> {
  await db
    .prepare(
      "INSERT INTO memberships (user_id, chapter_id, role, status, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(m.userId, m.chapterId, m.role, m.status, m.createdAt, m.approvedAt)
    .run();
}

export async function setRole(
  db: D1Database,
  userId: string,
  role: Role,
  chapterId: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE memberships SET role = ? WHERE user_id = ? AND chapter_id = ? AND status = 'active'",
    )
    .bind(role, userId, chapterId)
    .run();
}

export async function removeMembership(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<void> {
  await db
    .prepare("DELETE FROM memberships WHERE user_id = ? AND chapter_id = ?")
    .bind(userId, chapterId)
    .run();
}

export type ProtectedMembershipMutationResult = "updated" | "last_active_organizer" | "not_found";

/** Demotes an active organizer only when another active organizer remains. */
export async function demoteMembershipUnlessLastOrganizer(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<ProtectedMembershipMutationResult> {
  const existing = await getMembership(db, userId, chapterId);
  if (!existing) return "not_found";
  const result = await db
    .prepare(
      `UPDATE memberships SET role = 'member'
       WHERE user_id = ? AND chapter_id = ? AND status = 'active'
         AND (
           role <> 'organizer'
           OR EXISTS (
             SELECT 1 FROM memberships AS other
             WHERE other.chapter_id = ? AND other.status = 'active'
               AND other.role = 'organizer' AND other.user_id <> ?
           )
         )`,
    )
    .bind(userId, chapterId, chapterId, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0 ? "updated" : "last_active_organizer";
}

/** Removes a membership only when doing so keeps an active organizer in the chapter. */
export async function removeMembershipUnlessLastOrganizer(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<ProtectedMembershipMutationResult> {
  const existing = await getMembership(db, userId, chapterId);
  if (!existing) return "not_found";
  const result = await db
    .prepare(
      `DELETE FROM memberships
       WHERE user_id = ? AND chapter_id = ?
         AND (
           status <> 'active' OR role <> 'organizer'
           OR EXISTS (
             SELECT 1 FROM memberships AS other
             WHERE other.chapter_id = ? AND other.status = 'active'
               AND other.role = 'organizer' AND other.user_id <> ?
           )
         )`,
    )
    .bind(userId, chapterId, chapterId, userId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0 ? "updated" : "last_active_organizer";
}

export type SelfLeaveResult = "deleted" | "last_active_organizer" | "not_found";

/**
 * Atomic self-leave: deletes the user's membership only when removing it
 * would not leave the chapter without any active organizer.
 * - "deleted": the row was removed.
 * - "last_active_organizer": the row exists and the caller is the last active
 *   organizer; the DELETE was a no-op.
 * - "not_found": no membership row for (userId, chapterId) exists.
 */
export async function removeOwnMembershipUnlessLastOrganizer(
  db: D1Database,
  userId: string,
  chapterId: number,
): Promise<SelfLeaveResult> {
  const existing = await db
    .prepare("SELECT 1 AS ok FROM memberships WHERE user_id = ? AND chapter_id = ?")
    .bind(userId, chapterId)
    .first<{ ok: number }>();
  if (!existing) return "not_found";
  const result = await db
    .prepare(
      `DELETE FROM memberships
       WHERE user_id = ? AND chapter_id = ?
         AND NOT (
           role = 'organizer' AND status = 'active'
           AND (
             SELECT COUNT(*) FROM memberships
             WHERE chapter_id = ? AND status = 'active' AND role = 'organizer'
           ) <= 1
         )`,
    )
    .bind(userId, chapterId, chapterId)
    .run();
  const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
  return changes > 0 ? "deleted" : "last_active_organizer";
}
