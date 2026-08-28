/**
 * D1 access for the OST event registry. Auth tables (`user`, `oidc_session`)
 * are owned by gdg-lib; this module only touches `events`.
 */

export type OstEvent = {
  slug: string;
  title: string;
  chapterId: number;
  chapterSlug: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

type EventRow = {
  slug: string;
  title: string;
  chapter_id: number;
  chapter_slug: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};

const EVENT_COLS =
  "slug, title, chapter_id, chapter_slug, created_by, created_at, updated_at, deleted_at";

export function toEvent(r: EventRow): OstEvent {
  return {
    slug: r.slug,
    title: r.title,
    chapterId: r.chapter_id,
    chapterSlug: r.chapter_slug,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

export type CreateEventInput = {
  slug: string;
  title: string;
  chapterId: number;
  chapterSlug: string;
  createdBy: string | null;
};

export type CreateEventResult = { ok: true; event: OstEvent } | { ok: false; reason: "slug_taken" };

export async function createEvent(
  db: D1Database,
  input: CreateEventInput,
): Promise<CreateEventResult> {
  const existing = await getEventBySlug(db, input.slug);
  if (existing) return { ok: false, reason: "slug_taken" };
  try {
    await db
      .prepare(
        `INSERT INTO events (slug, title, chapter_id, chapter_slug, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.slug, input.title, input.chapterId, input.chapterSlug, input.createdBy)
      .run();
  } catch (err) {
    // Lost the race against a concurrent insert on the same slug.
    if (err instanceof Error && /UNIQUE|PRIMARY KEY|constraint/i.test(err.message)) {
      return { ok: false, reason: "slug_taken" };
    }
    throw err;
  }
  const event = await getEventBySlug(db, input.slug);
  if (!event) throw new Error("event vanished immediately after insert");
  return { ok: true, event };
}

export async function getEventBySlug(db: D1Database, slug: string): Promise<OstEvent | null> {
  const row = await db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE slug = ? AND deleted_at IS NULL`)
    .bind(slug)
    .first<EventRow>();
  return row ? toEvent(row) : null;
}

export async function listEventsForChapters(
  db: D1Database,
  chapterIds: number[],
): Promise<OstEvent[]> {
  if (chapterIds.length === 0) return [];
  const placeholders = chapterIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events
       WHERE deleted_at IS NULL AND chapter_id IN (${placeholders})
       ORDER BY created_at DESC`,
    )
    .bind(...chapterIds)
    .all<EventRow>();
  return (results ?? []).map(toEvent);
}

export async function softDeleteEvent(db: D1Database, slug: string): Promise<void> {
  await db
    .prepare("UPDATE events SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE slug = ?")
    .bind(slug)
    .run();
}
