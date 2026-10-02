export type CrossSheetConflict = {
  sheetId: string;
  sheetName: string;
  date: string;
  siblingSlotId: string;
  startTime: string;
  endTime: string;
  targetSlotId: string;
  targetStartTime: string;
  targetEndTime: string;
};

/** Cross-sheet collisions use strict interval overlap, so adjacent slots are valid. */
export async function findCrossSheetConflicts(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  applicationId: string,
  slotIds: readonly string[],
): Promise<CrossSheetConflict[]> {
  const conflicts = new Map<string, CrossSheetConflict>();
  for (const slotId of slotIds) {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT s.id AS sheet_id, s.name AS sheet_name, s.date, t.id AS sibling_slot_id,
                t.start_time, t.end_time, target.id AS target_slot_id,
                target.start_time AS target_start_time, target.end_time AS target_end_time
         FROM time_slots target
         JOIN roster_sheets target_sheet ON target_sheet.id = target.roster_sheet_id
           AND target_sheet.event_id = target.event_id AND target_sheet.deleted_at IS NULL
         JOIN assignments a ON a.event_id = target.event_id
           AND a.application_id = ? AND a.roster_sheet_id <> target.roster_sheet_id
         JOIN roster_sheets s ON s.id = a.roster_sheet_id AND s.event_id = a.event_id
           AND s.deleted_at IS NULL AND s.date = target_sheet.date
         JOIN time_slots t ON t.id = a.time_slot_id AND t.roster_sheet_id = s.id
           AND t.event_id = s.event_id
         WHERE target.event_id = ? AND target.roster_sheet_id = ? AND target.id = ?
           AND t.start_time < target.end_time AND target.start_time < t.end_time
         ORDER BY s.date, t.start_time, s.name`,
      )
      .bind(applicationId, eventId, rosterSheetId, slotId)
      .all<CrossSheetConflictRow>();
    for (const row of results ?? []) {
      const conflict = toConflict(row);
      conflicts.set(
        `${conflict.targetSlotId}:${conflict.sheetId}:${conflict.siblingSlotId}`,
        conflict,
      );
    }
  }
  return [...conflicts.values()];
}

type CrossSheetConflictRow = {
  sheet_id: string;
  sheet_name: string;
  date: string;
  sibling_slot_id: string;
  start_time: string;
  end_time: string;
  target_slot_id: string;
  target_start_time: string;
  target_end_time: string;
};

function toConflict(row: CrossSheetConflictRow): CrossSheetConflict {
  return {
    sheetId: row.sheet_id,
    sheetName: row.sheet_name,
    date: row.date,
    siblingSlotId: row.sibling_slot_id,
    startTime: row.start_time,
    endTime: row.end_time,
    targetSlotId: row.target_slot_id,
    targetStartTime: row.target_start_time,
    targetEndTime: row.target_end_time,
  };
}

export function canonicalizeConflicts(
  conflicts: readonly CrossSheetConflict[],
): CrossSheetConflict[] {
  const byKey = new Map(
    conflicts.map((conflict) => [
      `${conflict.targetSlotId}:${conflict.sheetId}:${conflict.siblingSlotId}`,
      conflict,
    ]),
  );
  return [...byKey.values()].sort((a, b) =>
    [a.targetSlotId, a.sheetId, a.siblingSlotId]
      .join("\u0000")
      .localeCompare([b.targetSlotId, b.sheetId, b.siblingSlotId].join("\u0000")),
  );
}

export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Duplicate each unconfirmed sibling row to trigger the assignment primary key.
 * Signed conflict rows are excluded only when all displayed details still match.
 * One parameter-bounded statement is built for each proposed slot.
 */
export function crossSheetConflictGuard(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  applicationId: string,
  slotId: string,
  allowedConflicts: readonly CrossSheetConflict[],
): D1PreparedStatement {
  const allowedForSlot = JSON.stringify(
    allowedConflicts.filter((conflict) => conflict.targetSlotId === slotId),
  );
  return db
    .prepare(
      `INSERT INTO assignments
         (event_id, application_id, time_slot_id, track_id, role_id, locked, roster_sheet_id)
       SELECT a.event_id, a.application_id, a.time_slot_id, a.track_id, a.role_id, a.locked,
              a.roster_sheet_id
       FROM assignments a
       JOIN time_slots sibling_slot ON sibling_slot.id = a.time_slot_id
         AND sibling_slot.event_id = a.event_id AND sibling_slot.roster_sheet_id = a.roster_sheet_id
       JOIN roster_sheets sibling_sheet ON sibling_sheet.id = a.roster_sheet_id
         AND sibling_sheet.event_id = a.event_id AND sibling_sheet.deleted_at IS NULL
       JOIN time_slots target_slot ON target_slot.id = ? AND target_slot.event_id = a.event_id
         AND target_slot.roster_sheet_id = ?
       JOIN roster_sheets target_sheet ON target_sheet.id = target_slot.roster_sheet_id
         AND target_sheet.event_id = target_slot.event_id AND target_sheet.deleted_at IS NULL
       WHERE a.event_id = ? AND a.application_id = ?
         AND a.roster_sheet_id <> target_sheet.id AND sibling_sheet.date = target_sheet.date
         AND sibling_slot.start_time < target_slot.end_time
         AND target_slot.start_time < sibling_slot.end_time
         AND NOT EXISTS (
           SELECT 1 FROM json_each(?) allowed
           WHERE json_extract(allowed.value, '$.sheetId') = sibling_sheet.id
             AND json_extract(allowed.value, '$.sheetName') = sibling_sheet.name
             AND json_extract(allowed.value, '$.date') = sibling_sheet.date
             AND json_extract(allowed.value, '$.siblingSlotId') = sibling_slot.id
             AND json_extract(allowed.value, '$.startTime') = sibling_slot.start_time
             AND json_extract(allowed.value, '$.endTime') = sibling_slot.end_time
             AND json_extract(allowed.value, '$.targetSlotId') = target_slot.id
             AND json_extract(allowed.value, '$.targetStartTime') = target_slot.start_time
             AND json_extract(allowed.value, '$.targetEndTime') = target_slot.end_time
         )`,
    )
    .bind(slotId, rosterSheetId, eventId, applicationId, allowedForSlot);
}

export function isCrossSheetConflictGuardFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(
      "UNIQUE constraint failed: assignments.application_id, assignments.time_slot_id",
    )
  );
}
