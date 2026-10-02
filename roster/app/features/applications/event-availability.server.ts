import { type AvailabilityInput, toAvailability } from "./availability.server";
import type { AvailabilityRecord } from "./types";

async function requireApplicationEvent(db: D1Database, applicationId: string): Promise<string> {
  const application = await db
    .prepare(`SELECT a.event_id FROM applications a
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ? AND e.deleted_at IS NULL`)
    .bind(applicationId)
    .first<{ event_id: string }>();
  if (!application) throw new Error("Application not found for a live event.");
  return application.event_id;
}

/** Callers authorize the application; archived sheets are excluded from form data. */
export async function listEventAvailabilityForApplication(
  db: D1Database,
  applicationId: string,
): Promise<AvailabilityRecord[]> {
  const eventId = await requireApplicationEvent(db, applicationId);
  const { results } = await db
    .prepare(`SELECT av.application_id, av.time_slot_id, av.value
      FROM availabilities av
      JOIN applications a ON a.id = av.application_id
      JOIN events e ON e.id = a.event_id AND e.deleted_at IS NULL
      JOIN time_slots ts ON ts.id = av.time_slot_id AND ts.event_id = a.event_id
      JOIN roster_sheets s ON s.id = ts.roster_sheet_id AND s.event_id = a.event_id
      WHERE av.application_id = ? AND a.event_id = ? AND s.deleted_at IS NULL
      ORDER BY s.sort_order, s.id, ts.idx, ts.id`)
    .bind(applicationId, eventId)
    .all<{ application_id: string; time_slot_id: string; value: string }>();
  return (results ?? []).map(toAvailability);
}

/**
 * Replaces the complete grid across live sheets, preserving archived-sheet rows.
 * The submitted IDs must exactly match all current live slots. A guard in the
 * same D1 transaction rejects stale/incomplete/foreign grids before deletion.
 * JSON input keeps the number of bound parameters constant for large grids.
 */
export async function setEventAvailability(
  db: D1Database,
  applicationId: string,
  entries: readonly AvailabilityInput[],
): Promise<void> {
  const eventId = await requireApplicationEvent(db, applicationId);
  if (
    new Set(entries.map((entry) => entry.timeSlotId)).size !== entries.length ||
    entries.some((entry) => !["o", "d", "x"].includes(entry.value))
  ) {
    throw new Error("Availability entries must have unique slots and valid values.");
  }
  const input = JSON.stringify(entries);
  const validScope = `SELECT 1 FROM applications a
    JOIN events e ON e.id = a.event_id
    WHERE a.id = ? AND a.event_id = ? AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM json_each(?) requested
        WHERE NOT EXISTS (
          SELECT 1 FROM time_slots ts
          JOIN roster_sheets s ON s.id = ts.roster_sheet_id AND s.event_id = ts.event_id
          WHERE ts.id = json_extract(requested.value, '$.timeSlotId')
            AND ts.event_id = a.event_id AND s.deleted_at IS NULL
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM time_slots ts
        JOIN roster_sheets s ON s.id = ts.roster_sheet_id AND s.event_id = ts.event_id
        WHERE ts.event_id = a.event_id AND s.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM json_each(?) requested
            WHERE json_extract(requested.value, '$.timeSlotId') = ts.id
          )
      )`;
  const valid = await db.prepare(validScope).bind(applicationId, eventId, input, input).first();
  if (!valid)
    throw new Error("Availability must include exactly the current live event time slots.");

  await db.batch([
    db
      .prepare(`INSERT INTO availabilities (application_id, time_slot_id, value)
        SELECT ?, '__event_availability_scope_guard__', 'invalid'
        WHERE NOT EXISTS (${validScope})`)
      .bind(applicationId, applicationId, eventId, input, input),
    db
      .prepare(`DELETE FROM availabilities
        WHERE application_id = ? AND time_slot_id IN (
          SELECT ts.id FROM time_slots ts
          JOIN roster_sheets s ON s.id = ts.roster_sheet_id AND s.event_id = ts.event_id
          WHERE ts.event_id = ? AND s.deleted_at IS NULL
        )`)
      .bind(applicationId, eventId),
    db
      .prepare(`INSERT INTO availabilities (application_id, time_slot_id, value)
        SELECT ?, json_extract(value, '$.timeSlotId'), json_extract(value, '$.value')
        FROM json_each(?)`)
      .bind(applicationId, input),
  ]);
}
