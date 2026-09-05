/**
 * D1 data access for discord-relay application tables (chapters, audit_log).
 * Auth tables (user, oidc_session) are managed by gdg-lib.
 */

export type ChapterRow = {
  chapter_id: number;
  slug: string;
  name: string | null;
  kind: string | null;
  fetched_at: number;
};

export type CachedChapter = {
  chapterId: number;
  slug: string;
  name: string | null;
  kind: string | null;
  fetchedAt: number;
};

export function toCachedChapter(row: ChapterRow): CachedChapter {
  return {
    chapterId: row.chapter_id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    fetchedAt: row.fetched_at,
  };
}

export type AuditLogRow = {
  id: string;
  actor_user_id: string;
  actor_role: string;
  chapter_id: number | null;
  action: string;
  target_type: string;
  target_id: string;
  occurred_at: number;
};

export type AuditLogEntry = {
  id: string;
  actorUserId: string;
  actorRole: "organizer" | "member" | "is_admin";
  chapterId: number | null;
  action: string;
  targetType: string;
  targetId: string;
  occurredAt: number;
};

export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorRole: row.actor_role as "organizer" | "member" | "is_admin",
    chapterId: row.chapter_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    occurredAt: row.occurred_at,
  };
}

export async function getCachedChapter(
  db: D1Database,
  chapterId: number,
): Promise<CachedChapter | null> {
  const row = await db
    .prepare("SELECT chapter_id, slug, name, kind, fetched_at FROM chapters WHERE chapter_id = ?")
    .bind(chapterId)
    .first<ChapterRow>();
  return row ? toCachedChapter(row) : null;
}

export async function listCachedChapters(db: D1Database): Promise<CachedChapter[]> {
  const { results } = await db
    .prepare(
      "SELECT chapter_id, slug, name, kind, fetched_at FROM chapters ORDER BY chapter_id ASC",
    )
    .all<ChapterRow>();
  return (results ?? []).map(toCachedChapter);
}
