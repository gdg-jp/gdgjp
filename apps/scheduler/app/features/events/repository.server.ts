import type { Slot } from "../scheduling/model";
import { createSlots, replaceSlots } from "../scheduling/repository.server";
import { newEventId } from "./id";
import type { Event } from "./model";
type EventRow = {
  id: string;
  title: string;
  description: string | null;
  slot_minutes: number;
  owner_user_id: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
};
const EVENT_COLS =
  "id, title, description, slot_minutes, owner_user_id, created_at, updated_at, deleted_at";
export function toEvent(r: EventRow): Event {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    slotMinutes: r.slot_minutes,
    ownerUserId: r.owner_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}
export type CreateEventInput = {
  title: string;
  description: string | null;
  slotMinutes: number;
  ownerUserId: string | null;
  slots: { dayOfWeek: number; startTime: string }[];
};

export async function createEventWithSlots(
  db: D1Database,
  input: CreateEventInput,
): Promise<{ event: Event; slots: Slot[] }> {
  const id = newEventId();
  const eventRow = await db
    .prepare(
      `INSERT INTO events (id, title, description, slot_minutes, owner_user_id)
       VALUES (?, ?, ?, ?, ?) RETURNING ${EVENT_COLS}`,
    )
    .bind(id, input.title, input.description, input.slotMinutes, input.ownerUserId)
    .first<EventRow>();
  if (!eventRow) throw new Error("Event insert returned no row");

  const slots = await createSlots(db, id, input.slots);
  return { event: toEvent(eventRow), slots };
}

export async function getEventById(db: D1Database, id: string): Promise<Event | null> {
  const row = await db
    .prepare(`SELECT ${EVENT_COLS} FROM events WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<EventRow>();
  return row ? toEvent(row) : null;
}

export async function listEventsForUser(
  db: D1Database,
  userId: string,
): Promise<{ event: Event; slotCount: number; participantCount: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.title, e.description, e.slot_minutes, e.owner_user_id, e.created_at, e.updated_at, e.deleted_at,
              (SELECT COUNT(*) FROM event_slots s WHERE s.event_id = e.id) AS slot_count,
              (SELECT COUNT(*) FROM event_participants p WHERE p.event_id = e.id) AS participant_count
       FROM events e
       WHERE e.owner_user_id = ? AND e.deleted_at IS NULL
       ORDER BY e.created_at DESC`,
    )
    .bind(userId)
    .all<EventRow & { slot_count: number; participant_count: number }>();
  return results.map((r) => ({
    event: toEvent(r),
    slotCount: r.slot_count,
    participantCount: r.participant_count,
  }));
}

export type UpdateEventInput = {
  title: string;
  description: string | null;
  slotMinutes: number;
  slots: { dayOfWeek: number; startTime: string }[];
};

// Returns the updated event + slots, or null if the event is missing or not owned by `ownerUserId`.
// Slots whose (day, time) match the new set are kept (preserving participant availabilities);
// the rest are deleted (cascading their availabilities) and new ones are inserted.
export async function updateEventForOwner(
  db: D1Database,
  id: string,
  ownerUserId: string,
  input: UpdateEventInput,
): Promise<{ event: Event; slots: Slot[] } | null> {
  const existing = await db
    .prepare(
      `SELECT ${EVENT_COLS} FROM events WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`,
    )
    .bind(id, ownerUserId)
    .first<EventRow>();
  if (!existing) return null;

  const eventRow = await db
    .prepare(
      `UPDATE events
       SET title = ?, description = ?, slot_minutes = ?, updated_at = unixepoch()
       WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL
       RETURNING ${EVENT_COLS}`,
    )
    .bind(input.title, input.description, input.slotMinutes, id, ownerUserId)
    .first<EventRow>();
  if (!eventRow) return null;

  const refreshed = await replaceSlots(db, id, input.slots);
  return { event: toEvent(eventRow), slots: refreshed };
}

export async function softDeleteEvent(
  db: D1Database,
  id: string,
  ownerUserId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE events SET deleted_at = unixepoch() WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL",
    )
    .bind(id, ownerUserId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
