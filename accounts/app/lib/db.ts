export type ChapterKind = "gdg" | "gdgoc";
export type Role = "organizer" | "member";
export type MembershipStatus = "pending" | "active";

export type UserChapter = {
  chapterId: number;
  chapterSlug: string;
  role: Role;
};

export type Chapter = {
  id: number;
  slug: string;
  name: string;
  kind: ChapterKind;
  createdAt: number;
};

export type Membership = {
  userId: string;
  chapterId: number;
  role: Role;
  status: MembershipStatus;
  createdAt: number;
  approvedAt: number | null;
};

export type MembershipWithChapter = Membership & { chapter: Chapter };

export type ChapterWithCounts = Chapter & {
  activeCount: number;
  pendingCount: number;
};

export type PendingRequestWithChapter = Membership & {
  chapter: Chapter;
  user: { id: string; email: string; name: string };
};

type ChapterRow = {
  id: number;
  slug: string;
  name: string;
  kind: ChapterKind;
  created_at: number;
};

type MembershipRow = {
  user_id: string;
  chapter_id: number;
  role: Role;
  status: MembershipStatus;
  created_at: number;
  approved_at: number | null;
};

type MembershipJoinRow = MembershipRow & {
  c_id: number;
  c_slug: string;
  c_name: string;
  c_kind: ChapterKind;
  c_created_at: number;
};

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

function toMembership(row: MembershipRow): Membership {
  return {
    userId: row.user_id,
    chapterId: row.chapter_id,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
  };
}

function toMembershipWithChapter(row: MembershipJoinRow): MembershipWithChapter {
  return {
    ...toMembership(row),
    chapter: {
      id: row.c_id,
      slug: row.c_slug,
      name: row.c_name,
      kind: row.c_kind,
      createdAt: row.c_created_at,
    },
  };
}

const MEMBERSHIP_JOIN_COLS = `
  m.user_id, m.chapter_id, m.role, m.status, m.created_at, m.approved_at,
  c.id   AS c_id,
  c.slug AS c_slug,
  c.name AS c_name,
  c.kind AS c_kind,
  c.created_at AS c_created_at
`;

export async function listChapters(db: D1Database): Promise<Chapter[]> {
  const { results } = await db
    .prepare("SELECT id, slug, name, kind, created_at FROM chapters ORDER BY name")
    .all<ChapterRow>();
  return results.map(toChapter);
}

export async function listChaptersWithCounts(db: D1Database): Promise<ChapterWithCounts[]> {
  const { results } = await db
    .prepare(
      `SELECT
         c.id, c.slug, c.name, c.kind, c.created_at,
         COALESCE(SUM(CASE WHEN m.status = 'active'  THEN 1 ELSE 0 END), 0) AS active_count,
         COALESCE(SUM(CASE WHEN m.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count
       FROM chapters c
       LEFT JOIN memberships m ON m.chapter_id = c.id
       GROUP BY c.id
       ORDER BY c.name`,
    )
    .all<ChapterRow & { active_count: number; pending_count: number }>();
  return results.map((row) => ({
    ...toChapter(row),
    activeCount: row.active_count,
    pendingCount: row.pending_count,
  }));
}

const CHAPTERS_COUNTS_CACHE_NAME = "chapters-with-counts";
const CHAPTERS_COUNTS_CACHE_KEY = "https://accounts.gdgs.jp/__cache/chapters-with-counts";
const CHAPTERS_COUNTS_TTL_SECONDS = 30;

async function openChaptersCountsCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  return caches.open(CHAPTERS_COUNTS_CACHE_NAME);
}

export async function listChaptersWithCountsCached(db: D1Database): Promise<ChapterWithCounts[]> {
  const cache = await openChaptersCountsCache();
  if (!cache) return listChaptersWithCounts(db);
  const hit = await cache.match(CHAPTERS_COUNTS_CACHE_KEY);
  if (hit) return (await hit.json()) as ChapterWithCounts[];
  const data = await listChaptersWithCounts(db);
  await cache.put(
    CHAPTERS_COUNTS_CACHE_KEY,
    new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json",
        "cache-control": `max-age=${CHAPTERS_COUNTS_TTL_SECONDS}`,
      },
    }),
  );
  return data;
}

export async function bustChaptersWithCountsCache(): Promise<void> {
  const cache = await openChaptersCountsCache();
  if (!cache) return;
  await cache.delete(CHAPTERS_COUNTS_CACHE_KEY);
}

export async function getChapterBySlug(db: D1Database, slug: string): Promise<Chapter | null> {
  const row = await db
    .prepare("SELECT id, slug, name, kind, created_at FROM chapters WHERE slug = ?")
    .bind(slug)
    .first<ChapterRow>();
  return row ? toChapter(row) : null;
}

export async function getChapterById(db: D1Database, id: number): Promise<Chapter | null> {
  const row = await db
    .prepare("SELECT id, slug, name, kind, created_at FROM chapters WHERE id = ?")
    .bind(id)
    .first<ChapterRow>();
  return row ? toChapter(row) : null;
}

export async function createChapter(
  db: D1Database,
  input: { slug: string; name: string; kind: ChapterKind },
): Promise<void> {
  await db
    .prepare("INSERT INTO chapters (slug, name, kind) VALUES (?, ?, ?)")
    .bind(input.slug, input.name, input.kind)
    .run();
}

export async function deleteChapter(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM chapters WHERE id = ?").bind(id).run();
}

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
         c.id AS c_id, c.slug AS c_slug, c.name AS c_name, c.kind AS c_kind, c.created_at AS c_created_at,
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

export type UserSummary = { id: string; email: string; name: string };

export async function getUserById(db: D1Database, userId: string): Promise<UserSummary | null> {
  const row = await db
    .prepare(`SELECT id, email, name FROM "user" WHERE id = ?`)
    .bind(userId)
    .first<UserSummary>();
  return row ?? null;
}

export async function getUsersByIds(
  db: D1Database,
  ids: string[],
): Promise<Record<string, UserSummary>> {
  if (ids.length === 0) return {};
  const placeholders = ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id, email, name FROM "user" WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<UserSummary>();
  const out: Record<string, UserSummary> = {};
  for (const u of results) out[u.id] = u;
  return out;
}
