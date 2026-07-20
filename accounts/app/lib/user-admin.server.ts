export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
  createdAt: number | string;
  updatedAt: number | string;
  emailVerified: boolean;
  membershipCount: number;
  activeMembershipCount: number;
  pendingMembershipCount: number;
  sessionCount: number;
};

export type ManagedUserPage = {
  users: ManagedUser[];
  page: number;
  pageSize: number;
  total: number;
};

export type ListManagedUsersInput = {
  query?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export type UserAdminUpdateResult =
  | { status: "updated" }
  | { status: "not_found" }
  | { status: "last_admin" };

export type UserSessionRevocationResult =
  | { status: "revoked" }
  | { status: "not_found" }
  | { status: "self_revoke" };

type ManagedUserRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  is_admin: number | boolean;
  created_at: number | string;
  updated_at: number | string;
  email_verified: number | boolean;
  membership_count: number;
  active_membership_count: number;
  pending_membership_count: number;
  session_count: number;
};

type CountRow = { total: number };

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * Lists accounts for the administrator UI. Counts are aggregated in SQL so the
 * caller does not need to make per-user queries.
 */
export async function listManagedUsers(
  db: D1Database,
  input: ListManagedUsersInput = {},
): Promise<ManagedUserPage> {
  const page = normalizePositiveInteger(input.page, 1);
  const pageSize = Math.min(
    normalizePositiveInteger(input.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );
  const query = input.query?.trim() ?? "";
  const { where, params } = managedUserSearch(query);
  const offset = (page - 1) * pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .prepare(
        `SELECT
           u.id, u.name, u.email, u.image, u.is_admin, u.created_at, u.updated_at, u.email_verified,
           COUNT(DISTINCT m.chapter_id) AS membership_count,
           COUNT(DISTINCT CASE WHEN m.status = 'active' THEN m.chapter_id END) AS active_membership_count,
           COUNT(DISTINCT CASE WHEN m.status = 'pending' THEN m.chapter_id END) AS pending_membership_count,
           COUNT(DISTINCT s.id) AS session_count
         FROM "user" u
         LEFT JOIN memberships m ON m.user_id = u.id
         LEFT JOIN "session" s ON s."userId" = u.id
         ${where}
         GROUP BY u.id
         ORDER BY u.created_at DESC, u.id
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, pageSize, offset)
      .all<ManagedUserRow>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM "user" u ${where}`)
      .bind(...params)
      .first<CountRow>(),
  ]);

  return {
    users: rows.results.map(toManagedUser),
    page,
    pageSize,
    total: totalRow?.total ?? 0,
  };
}

/**
 * Changes a user's administrator flag. The conditional update preserves the
 * invariant that at least one administrator remains, including under concurrent requests.
 */
export async function setUserAdmin(
  db: D1Database,
  input: { actorId: string; targetId: string; isAdmin: boolean },
): Promise<UserAdminUpdateResult> {
  const isAdmin = input.isAdmin ? 1 : 0;
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE "user"
       SET is_admin = ?, updated_at = unixepoch()
       WHERE id = ?
         AND (
           ? = 1
           OR is_admin = 0
           OR EXISTS (SELECT 1 FROM "user" WHERE is_admin = 1 AND id <> ?)
         )`,
      )
      .bind(isAdmin, input.targetId, isAdmin, input.targetId),
    // Each delete is guarded by the resulting flag. If the protected update
    // fails (for example, because this is the last admin), no credentials are revoked.
    db
      .prepare(
        `DELETE FROM "oauthAccessToken"
         WHERE "userId" = ?
           AND EXISTS (SELECT 1 FROM "user" WHERE id = ? AND is_admin = ?)`,
      )
      .bind(input.targetId, input.targetId, isAdmin),
    db
      .prepare(
        `DELETE FROM "oauthRefreshToken"
         WHERE "userId" = ?
           AND EXISTS (SELECT 1 FROM "user" WHERE id = ? AND is_admin = ?)`,
      )
      .bind(input.targetId, input.targetId, isAdmin),
    db
      .prepare(
        `DELETE FROM "session"
         WHERE "userId" = ?
           AND EXISTS (SELECT 1 FROM "user" WHERE id = ? AND is_admin = ?)`,
      )
      .bind(input.targetId, input.targetId, isAdmin),
  ]);

  if (update.meta.changes === 1) return { status: "updated" };

  const target = await db
    .prepare('SELECT is_admin FROM "user" WHERE id = ?')
    .bind(input.targetId)
    .first<{ is_admin: number | boolean }>();
  if (!target) return { status: "not_found" };
  return { status: "last_admin" };
}

/**
 * Invalidates every first-party session and issued OAuth token for a user.
 * The batch is atomic: it never leaves a user with only a partially revoked credential set.
 */
export async function revokeUserSessions(
  db: D1Database,
  input: { actorId: string; targetId: string },
): Promise<UserSessionRevocationResult> {
  if (input.actorId === input.targetId) return { status: "self_revoke" };

  const target = await db
    .prepare('SELECT 1 AS ok FROM "user" WHERE id = ?')
    .bind(input.targetId)
    .first<{ ok: number }>();
  if (!target) return { status: "not_found" };

  await db.batch([
    db.prepare('DELETE FROM "oauthAccessToken" WHERE "userId" = ?').bind(input.targetId),
    db.prepare('DELETE FROM "oauthRefreshToken" WHERE "userId" = ?').bind(input.targetId),
    db.prepare('DELETE FROM "session" WHERE "userId" = ?').bind(input.targetId),
  ]);
  return { status: "revoked" };
}

function managedUserSearch(query: string): { where: string; params: string[] } {
  if (!query) return { where: "", params: [] };
  const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return {
    where:
      "WHERE (u.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR u.email LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    params: [`%${escaped}%`, `%${escaped}%`],
  };
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.floor(value);
}

function toManagedUser(row: ManagedUserRow): ManagedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    image: row.image,
    isAdmin: row.is_admin === 1 || row.is_admin === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    emailVerified: row.email_verified === 1 || row.email_verified === true,
    membershipCount: row.membership_count,
    activeMembershipCount: row.active_membership_count,
    pendingMembershipCount: row.pending_membership_count,
    sessionCount: row.session_count,
  };
}
