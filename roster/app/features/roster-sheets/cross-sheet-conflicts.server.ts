import { RosterSheetMutationError, getRosterSheet } from "./roster-sheets.server";

export type CrossSheetAssignmentConflict = {
  application: { id: string; name: string };
  target: {
    sheetId: string;
    slotId: string;
    startTime: string;
    endTime: string;
    trackId: string;
    roleId: string;
  };
  other: {
    sheetId: string;
    sheetName: string;
    sheetDate: string;
    slotId: string;
    startTime: string;
    endTime: string;
    trackId: string;
    roleId: string;
  };
};

type ConflictRow = {
  application_id: string;
  application_name: string;
  target_sheet_id: string;
  target_slot_id: string;
  target_start_time: string;
  target_end_time: string;
  target_track_id: string;
  target_role_id: string;
  other_sheet_id: string;
  other_sheet_name: string;
  other_sheet_date: string;
  other_slot_id: string;
  other_start_time: string;
  other_end_time: string;
  other_track_id: string;
  other_role_id: string;
};

/**
 * Finds assignments on other live sheets that overlap actual target-sheet
 * assignments for the same applicant. Sheets only conflict on the same date;
 * slot intervals use half-open boundaries, so adjacent shifts are allowed.
 */
export async function listCrossSheetAssignmentConflicts(
  db: D1Database,
  eventId: string,
  targetSheetId: string,
): Promise<CrossSheetAssignmentConflict[]> {
  if (!(await getRosterSheet(db, eventId, targetSheetId))) {
    throw new RosterSheetMutationError("Roster sheet not found for this event.");
  }

  const { results } = await db
    .prepare(
      `SELECT
         app.id AS application_id,
         app.name AS application_name,
         target_assignment.roster_sheet_id AS target_sheet_id,
         target_slot.id AS target_slot_id,
         target_slot.start_time AS target_start_time,
         target_slot.end_time AS target_end_time,
         target_assignment.track_id AS target_track_id,
         target_assignment.role_id AS target_role_id,
         other_sheet.id AS other_sheet_id,
         other_sheet.name AS other_sheet_name,
         other_sheet.date AS other_sheet_date,
         other_slot.id AS other_slot_id,
         other_slot.start_time AS other_start_time,
         other_slot.end_time AS other_end_time,
         other_assignment.track_id AS other_track_id,
         other_assignment.role_id AS other_role_id
       FROM assignments AS target_assignment
       JOIN applications AS app
         ON app.id = target_assignment.application_id
        AND app.event_id = target_assignment.event_id
       JOIN time_slots AS target_slot
         ON target_slot.id = target_assignment.time_slot_id
        AND target_slot.event_id = target_assignment.event_id
        AND target_slot.roster_sheet_id = target_assignment.roster_sheet_id
       JOIN roster_sheets AS target_sheet
         ON target_sheet.id = target_assignment.roster_sheet_id
        AND target_sheet.event_id = target_assignment.event_id
       JOIN events AS event
         ON event.id = target_assignment.event_id
       JOIN assignments AS other_assignment
         ON other_assignment.application_id = app.id
        AND other_assignment.event_id = target_assignment.event_id
        AND other_assignment.roster_sheet_id <> target_assignment.roster_sheet_id
       JOIN roster_sheets AS other_sheet
         ON other_sheet.id = other_assignment.roster_sheet_id
        AND other_sheet.event_id = target_assignment.event_id
       JOIN time_slots AS other_slot
         ON other_slot.id = other_assignment.time_slot_id
        AND other_slot.event_id = other_assignment.event_id
        AND other_slot.roster_sheet_id = other_assignment.roster_sheet_id
       WHERE target_assignment.event_id = ?
         AND target_assignment.roster_sheet_id = ?
         AND app.withdrawn = 0
         AND target_sheet.deleted_at IS NULL
         AND other_sheet.deleted_at IS NULL
         AND event.deleted_at IS NULL
         AND other_sheet.date = target_sheet.date
         AND target_slot.start_time < other_slot.end_time
         AND other_slot.start_time < target_slot.end_time
       ORDER BY app.name COLLATE NOCASE, app.id,
         target_slot.start_time, target_slot.end_time, target_slot.id,
         other_sheet.name COLLATE NOCASE, other_sheet.id,
         other_slot.start_time, other_slot.end_time, other_slot.id,
         other_assignment.track_id, other_assignment.role_id`,
    )
    .bind(eventId, targetSheetId)
    .all<ConflictRow>();

  return (results ?? []).map((row) => ({
    application: {
      id: row.application_id,
      name: row.application_name,
    },
    target: {
      sheetId: row.target_sheet_id,
      slotId: row.target_slot_id,
      startTime: row.target_start_time,
      endTime: row.target_end_time,
      trackId: row.target_track_id,
      roleId: row.target_role_id,
    },
    other: {
      sheetId: row.other_sheet_id,
      sheetName: row.other_sheet_name,
      sheetDate: row.other_sheet_date,
      slotId: row.other_slot_id,
      startTime: row.other_start_time,
      endTime: row.other_end_time,
      trackId: row.other_track_id,
      roleId: row.other_role_id,
    },
  }));
}
