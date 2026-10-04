import type { Availability, Participant } from "../participants/model";
import {
  type AvailabilityRow,
  PARTICIPANT_COLS,
  type ParticipantRow,
  toParticipant,
} from "../participants/repository.server";
import type { Slot } from "../scheduling/model";
import { SLOT_COLS, type SlotRow, toSlot } from "../scheduling/repository.server";
import type { Event } from "./model";
import { getEventById } from "./repository.server";
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
