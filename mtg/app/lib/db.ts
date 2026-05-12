import { newEventId } from "./id";

// day_of_week: 0=Mon..6=Sun (ISO weekday).
export type Event = {
  id: string;
  title: string;
  description: string | null;
  slotMinutes: number;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
};

export type Slot = {
  id: number;
  eventId: string;
  dayOfWeek: number;
  startTime: string;
};

export type Participant = {
  id: number;
  eventId: string;
  userId: string | null;
  displayName: string;
  editTokenHash: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Availability = { participantId: number; slotId: number };

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
type SlotRow = { id: number; event_id: string; day_of_week: number; start_time: string };
type ParticipantRow = {
  id: number;
  event_id: string;
  user_id: string | null;
  display_name: string;
  edit_token_hash: string | null;
  created_at: number;
  updated_at: number;
};
type AvailabilityRow = { participant_id: number; slot_id: number };

const EVENT_COLS =
  "id, title, description, slot_minutes, owner_user_id, created_at, updated_at, deleted_at";
const SLOT_COLS = "id, event_id, day_of_week, start_time";
const PARTICIPANT_COLS =
  "id, event_id, user_id, display_name, edit_token_hash, created_at, updated_at";

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
function toSlot(r: SlotRow): Slot {
  return { id: r.id, eventId: r.event_id, dayOfWeek: r.day_of_week, startTime: r.start_time };
}
function toParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id,
    eventId: r.event_id,
    userId: r.user_id,
    displayName: r.display_name,
    editTokenHash: r.edit_token_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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

  const slotStmt = db.prepare(
    `INSERT INTO event_slots (event_id, day_of_week, start_time) VALUES (?, ?, ?) RETURNING ${SLOT_COLS}`,
  );
  const slotRows: SlotRow[] = [];
  for (const s of input.slots) {
    const row = await slotStmt.bind(id, s.dayOfWeek, s.startTime).first<SlotRow>();
    if (row) slotRows.push(row);
  }
  return { event: toEvent(eventRow), slots: slotRows.map(toSlot) };
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

export type EventBundle = {
  event: Event;
  slots: Slot[];
  participants: Participant[];
  availabilities: Availability[];
};

export async function getEventBundle(db: D1Database, id: string): Promise<EventBundle | null> {
  const event = await getEventById(db, id);
  if (!event) return null;
  const [{ results: slotRows }, { results: participantRows }, { results: availRows }] =
    await db.batch<SlotRow | ParticipantRow | AvailabilityRow>([
      db
        .prepare(
          `SELECT ${SLOT_COLS} FROM event_slots WHERE event_id = ? ORDER BY day_of_week, start_time`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT ${PARTICIPANT_COLS} FROM event_participants WHERE event_id = ? ORDER BY created_at`,
        )
        .bind(id),
      db
        .prepare(
          `SELECT a.participant_id, a.slot_id
           FROM event_availabilities a
           JOIN event_participants p ON p.id = a.participant_id
           WHERE p.event_id = ?`,
        )
        .bind(id),
    ]);
  return {
    event,
    slots: (slotRows as SlotRow[]).map(toSlot),
    participants: (participantRows as ParticipantRow[]).map(toParticipant),
    availabilities: (availRows as AvailabilityRow[]).map((r) => ({
      participantId: r.participant_id,
      slotId: r.slot_id,
    })),
  };
}

export async function createParticipant(
  db: D1Database,
  input: {
    eventId: string;
    userId: string | null;
    displayName: string;
    editTokenHash: string | null;
  },
): Promise<Participant> {
  const row = await db
    .prepare(
      `INSERT INTO event_participants (event_id, user_id, display_name, edit_token_hash)
       VALUES (?, ?, ?, ?) RETURNING ${PARTICIPANT_COLS}`,
    )
    .bind(input.eventId, input.userId, input.displayName, input.editTokenHash)
    .first<ParticipantRow>();
  if (!row) throw new Error("Participant insert returned no row");
  return toParticipant(row);
}

export async function findParticipantById(
  db: D1Database,
  eventId: string,
  participantId: number,
): Promise<Participant | null> {
  const row = await db
    .prepare(`SELECT ${PARTICIPANT_COLS} FROM event_participants WHERE id = ? AND event_id = ?`)
    .bind(participantId, eventId)
    .first<ParticipantRow>();
  return row ? toParticipant(row) : null;
}

export async function findParticipantByUser(
  db: D1Database,
  eventId: string,
  userId: string,
): Promise<Participant | null> {
  const row = await db
    .prepare(
      `SELECT ${PARTICIPANT_COLS} FROM event_participants WHERE event_id = ? AND user_id = ?`,
    )
    .bind(eventId, userId)
    .first<ParticipantRow>();
  return row ? toParticipant(row) : null;
}

export async function setAvailability(
  db: D1Database,
  participantId: number,
  slotIds: number[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM event_availabilities WHERE participant_id = ?").bind(participantId),
    db
      .prepare("UPDATE event_participants SET updated_at = unixepoch() WHERE id = ?")
      .bind(participantId),
  ];
  if (slotIds.length > 0) {
    const insertStmt = db.prepare(
      "INSERT INTO event_availabilities (participant_id, slot_id) VALUES (?, ?)",
    );
    for (const slotId of slotIds) statements.push(insertStmt.bind(participantId, slotId));
  }
  await db.batch(statements);
}
