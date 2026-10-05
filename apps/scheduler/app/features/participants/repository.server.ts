import type { Participant } from "./model";
export type ParticipantRow = {
  id: number;
  event_id: string;
  user_id: string | null;
  display_name: string;
  edit_token_hash: string | null;
  created_at: number;
  updated_at: number;
};
export type AvailabilityRow = { participant_id: number; slot_id: number };

export const PARTICIPANT_COLS =
  "id, event_id, user_id, display_name, edit_token_hash, created_at, updated_at";

export function toParticipant(r: ParticipantRow): Participant {
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

export async function deleteParticipant(db: D1Database, participantId: number): Promise<void> {
  await db.prepare("DELETE FROM event_participants WHERE id = ?").bind(participantId).run();
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
