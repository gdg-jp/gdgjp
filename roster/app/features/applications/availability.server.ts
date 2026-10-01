import type { AvailabilityRecord, AvailabilityValue } from "./types";

/**
 * D1 access for `availabilities` (docs/roster/index.md §4). Same wholesale
 * delete-all-then-insert shape as `./skills.server` — the apply form always
 * submits the full grid (every event time slot needs an entry, per
 * `./validate.ts`), so there is never a partial update to reconcile.
 */

type AvailabilityRow = {
  application_id: string;
  time_slot_id: string;
  value: string;
};

const AVAILABILITY_COLS = "application_id, time_slot_id, value";

export function toAvailability(r: AvailabilityRow): AvailabilityRecord {
  return {
    applicationId: r.application_id,
    timeSlotId: r.time_slot_id,
    value: r.value as AvailabilityValue,
  };
}

export async function listAvailabilityForApplication(
  db: D1Database,
  applicationId: string,
  rosterSheetId?: string,
): Promise<AvailabilityRecord[]> {
  const scope = await resolveAvailabilityScope(db, applicationId, rosterSheetId);
  const { results } = await db
    .prepare(
      `SELECT ${AVAILABILITY_COLS} FROM availabilities
       WHERE application_id = ? AND time_slot_id IN (
         SELECT id FROM time_slots WHERE event_id = ? AND roster_sheet_id = ?
       )`,
    )
    .bind(applicationId, scope.eventId, scope.rosterSheetId)
    .all<AvailabilityRow>();
  return (results ?? []).map(toAvailability);
}

export type AvailabilityInput = { timeSlotId: string; value: AvailabilityValue };

/** Replaces the application's whole availability grid — never a partial merge. */
export async function setAvailability(
  db: D1Database,
  applicationId: string,
  entries: readonly AvailabilityInput[],
  rosterSheetId?: string,
): Promise<void> {
  const scope = await resolveAvailabilityScope(db, applicationId, rosterSheetId);
  for (const entry of entries) {
    const slot = await db
      .prepare(
        `SELECT id FROM time_slots
         WHERE id = ? AND event_id = ? AND roster_sheet_id = ?`,
      )
      .bind(entry.timeSlotId, scope.eventId, scope.rosterSheetId)
      .first<{ id: string }>();
    if (!slot) throw new Error("Availability time slot not found for this roster sheet.");
  }

  const requestedSlots = entries.length
    ? entries.map(() => "SELECT ? AS id").join(" UNION ALL ")
    : "SELECT NULL AS id WHERE 0";
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO availabilities (application_id, time_slot_id, value)
         SELECT ?, '__availability_scope_guard__', 'invalid'
         WHERE NOT EXISTS (
           SELECT 1 FROM applications a
           JOIN events e ON e.id = a.event_id
           JOIN roster_sheets s ON s.event_id = a.event_id
           WHERE a.id = ? AND e.deleted_at IS NULL
             AND s.id = ? AND s.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM (${requestedSlots}) requested
               WHERE NOT EXISTS (
                 SELECT 1 FROM time_slots ts
                 WHERE ts.id = requested.id
                   AND ts.event_id = a.event_id
                   AND ts.roster_sheet_id = s.id
               )
             )
         )`,
      )
      .bind(applicationId, applicationId, scope.rosterSheetId, ...entries.map((e) => e.timeSlotId)),
    db
      .prepare(
        `DELETE FROM availabilities
         WHERE application_id = ?
           AND EXISTS (
             SELECT 1 FROM applications a
             JOIN events e ON e.id = a.event_id
             JOIN roster_sheets s ON s.event_id = a.event_id
             WHERE a.id = availabilities.application_id AND e.deleted_at IS NULL
               AND s.id = ? AND s.deleted_at IS NULL
           )
           AND time_slot_id IN (
             SELECT ts.id FROM time_slots ts
             WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
         )`,
      )
      .bind(applicationId, scope.rosterSheetId, scope.eventId, scope.rosterSheetId),
  ];
  for (const entry of entries) {
    statements.push(
      db
        .prepare(
          `INSERT INTO availabilities (application_id, time_slot_id, value)
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM applications a
             JOIN events e ON e.id = a.event_id
             JOIN roster_sheets s ON s.event_id = a.event_id
             JOIN time_slots ts ON ts.roster_sheet_id = s.id AND ts.event_id = a.event_id
             WHERE a.id = ? AND e.deleted_at IS NULL AND s.id = ?
               AND s.deleted_at IS NULL AND ts.id = ?
           )`,
        )
        .bind(
          applicationId,
          entry.timeSlotId,
          entry.value,
          applicationId,
          scope.rosterSheetId,
          entry.timeSlotId,
        ),
    );
  }
  await db.batch(statements);
}

type AvailabilityScope = { eventId: string; rosterSheetId: string };

/** Resolve an application to its live event and either the requested sheet or legacy default. */
async function resolveAvailabilityScope(
  db: D1Database,
  applicationId: string,
  requestedSheetId?: string,
): Promise<AvailabilityScope> {
  const application = await db
    .prepare(
      `SELECT a.event_id AS event_id FROM applications a
       JOIN events e ON e.id = a.event_id
       WHERE a.id = ? AND e.deleted_at IS NULL`,
    )
    .bind(applicationId)
    .first<{ event_id: string }>();
  if (!application) throw new Error("Application not found for a live event.");

  const rosterSheetId = requestedSheetId ?? `default:${application.event_id}`;
  const sheet = await db
    .prepare(
      `SELECT s.id FROM roster_sheets s
       JOIN events e ON e.id = s.event_id
       WHERE s.id = ? AND s.event_id = ?
         AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
    )
    .bind(rosterSheetId, application.event_id)
    .first<{ id: string }>();
  if (!sheet) throw new Error("Roster sheet not found for this application event.");
  return { eventId: application.event_id, rosterSheetId: sheet.id };
}
