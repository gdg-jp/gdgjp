import { type Assignments, parseAssignmentKey } from "../solver/types";
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

type OverlappingAssignmentSlotRow = {
  application_id: string;
  target_slot_id: string;
};

type ProposedAssignment = {
  applicationId: string;
  slotId: string;
  trackId: string;
  roleId: string;
  startTime: string;
  endTime: string;
};

type ProposedTargetRow = {
  application_id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
};

type OtherAssignmentRow = {
  application_id: string;
  application_name: string;
  sheet_id: string;
  sheet_name: string;
  sheet_date: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  track_id: string;
  role_id: string;
};

function compareText(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  return lowerA < lowerB ? -1 : lowerA > lowerB ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function compareConflicts(
  a: CrossSheetAssignmentConflict,
  b: CrossSheetAssignmentConflict,
): number {
  return (
    compareText(a.application.name, b.application.name) ||
    compareText(a.application.id, b.application.id) ||
    a.target.startTime.localeCompare(b.target.startTime) ||
    a.target.endTime.localeCompare(b.target.endTime) ||
    compareText(a.target.slotId, b.target.slotId) ||
    compareText(a.other.sheetName, b.other.sheetName) ||
    compareText(a.other.sheetId, b.other.sheetId) ||
    a.other.startTime.localeCompare(b.other.startTime) ||
    a.other.endTime.localeCompare(b.other.endTime) ||
    compareText(a.other.slotId, b.other.slotId) ||
    compareText(a.other.trackId, b.other.trackId) ||
    compareText(a.other.roleId, b.other.roleId)
  );
}

export async function listProposedCrossSheetAssignmentConflicts(
  db: D1Database,
  eventId: string,
  targetSheetId: string,
  assignments: Assignments,
): Promise<CrossSheetAssignmentConflict[]> {
  const targetSheet = await getRosterSheet(db, eventId, targetSheetId);
  if (!targetSheet) {
    throw new RosterSheetMutationError("Roster sheet not found for this event.");
  }

  const proposed: ProposedAssignment[] = [...assignments].map(([key, value]) => {
    const { applicationId, slotId } = parseAssignmentKey(key);
    return {
      applicationId,
      slotId,
      trackId: value.trackId,
      roleId: value.roleId,
      startTime: "",
      endTime: "",
    };
  });
  if (proposed.length === 0) return [];

  const validated = new Map<string, ProposedTargetRow>();
  for (let offset = 0; offset < proposed.length; offset += 20) {
    const batch = proposed.slice(offset, offset + 20);
    const values = batch.map(() => "(?, ?)").join(", ");
    const binds: string[] = [];
    for (const assignment of batch) binds.push(assignment.applicationId, assignment.slotId);
    const { results } = await db
      .prepare(
        `WITH proposal(application_id, slot_id) AS (VALUES ${values})
         SELECT proposal.application_id, proposal.slot_id,
                slot.start_time, slot.end_time
         FROM proposal
         JOIN applications AS app
           ON app.id = proposal.application_id AND app.event_id = ?
         JOIN time_slots AS slot
           ON slot.id = proposal.slot_id AND slot.event_id = app.event_id
          AND slot.roster_sheet_id = ?
         JOIN roster_sheets AS sheet
           ON sheet.id = slot.roster_sheet_id AND sheet.event_id = app.event_id
          AND sheet.deleted_at IS NULL
         JOIN events AS event ON event.id = app.event_id AND event.deleted_at IS NULL`,
      )
      .bind(...binds, eventId, targetSheetId)
      .all<ProposedTargetRow>();
    for (const row of results ?? []) validated.set(`${row.application_id}|${row.slot_id}`, row);
  }
  if (validated.size !== proposed.length) {
    throw new RosterSheetMutationError(
      "Proposed assignment references an application or slot outside this roster sheet.",
    );
  }
  for (const assignment of proposed) {
    const row = validated.get(`${assignment.applicationId}|${assignment.slotId}`);
    if (row) {
      assignment.startTime = row.start_time;
      assignment.endTime = row.end_time;
    }
  }

  const { results: otherRows } = await db
    .prepare(
      `SELECT app.id AS application_id, app.name AS application_name,
              other_sheet.id AS sheet_id, other_sheet.name AS sheet_name,
              other_sheet.date AS sheet_date, other_slot.id AS slot_id,
              other_slot.start_time, other_slot.end_time,
              other_assignment.track_id, other_assignment.role_id
       FROM assignments AS other_assignment
       JOIN applications AS app
         ON app.id = other_assignment.application_id
        AND app.event_id = other_assignment.event_id
       JOIN roster_sheets AS other_sheet
         ON other_sheet.id = other_assignment.roster_sheet_id
        AND other_sheet.event_id = other_assignment.event_id
       JOIN time_slots AS other_slot
         ON other_slot.id = other_assignment.time_slot_id
        AND other_slot.event_id = other_assignment.event_id
        AND other_slot.roster_sheet_id = other_assignment.roster_sheet_id
       JOIN events AS event ON event.id = other_assignment.event_id
       WHERE other_assignment.event_id = ?
         AND other_assignment.roster_sheet_id <> ?
         AND app.withdrawn = 0
         AND other_sheet.deleted_at IS NULL
         AND event.deleted_at IS NULL
         AND other_sheet.date = ?
       ORDER BY app.name COLLATE NOCASE, app.id,
         other_sheet.name COLLATE NOCASE, other_sheet.id,
         other_slot.start_time, other_slot.end_time, other_slot.id,
         other_assignment.track_id, other_assignment.role_id`,
    )
    .bind(eventId, targetSheetId, targetSheet.date)
    .all<OtherAssignmentRow>();

  const othersByApplication = new Map<string, OtherAssignmentRow[]>();
  for (const row of otherRows ?? []) {
    const rows = othersByApplication.get(row.application_id) ?? [];
    rows.push(row);
    othersByApplication.set(row.application_id, rows);
  }

  const conflicts: CrossSheetAssignmentConflict[] = [];
  for (const assignment of proposed) {
    for (const other of othersByApplication.get(assignment.applicationId) ?? []) {
      if (assignment.startTime >= other.end_time || other.start_time >= assignment.endTime)
        continue;
      conflicts.push({
        application: { id: other.application_id, name: other.application_name },
        target: {
          sheetId: targetSheetId,
          slotId: assignment.slotId,
          startTime: assignment.startTime,
          endTime: assignment.endTime,
          trackId: assignment.trackId,
          roleId: assignment.roleId,
        },
        other: {
          sheetId: other.sheet_id,
          sheetName: other.sheet_name,
          sheetDate: other.sheet_date,
          slotId: other.slot_id,
          startTime: other.start_time,
          endTime: other.end_time,
          trackId: other.track_id,
          roleId: other.role_id,
        },
      });
    }
  }
  return conflicts.sort(compareConflicts);
}

/**
 * Returns target-sheet slots that an applicant cannot take because they
 * already have an overlapping assignment on another live sheet for this event.
 * This deliberately selects identifiers only; solver input does not need PII.
 */
export async function listCrossSheetAssignmentOverlapByApplication(
  db: D1Database,
  eventId: string,
  targetSheetId: string,
): Promise<Map<string, Set<string>>> {
  if (!(await getRosterSheet(db, eventId, targetSheetId))) {
    throw new RosterSheetMutationError("Roster sheet not found for this event.");
  }

  const { results } = await db
    .prepare(
      `SELECT DISTINCT
         app.id AS application_id,
         target_slot.id AS target_slot_id
       FROM applications AS app
       JOIN assignments AS other_assignment
         ON other_assignment.application_id = app.id
        AND other_assignment.event_id = app.event_id
       JOIN roster_sheets AS other_sheet
         ON other_sheet.id = other_assignment.roster_sheet_id
        AND other_sheet.event_id = other_assignment.event_id
       JOIN time_slots AS other_slot
         ON other_slot.id = other_assignment.time_slot_id
        AND other_slot.event_id = other_assignment.event_id
        AND other_slot.roster_sheet_id = other_assignment.roster_sheet_id
       JOIN roster_sheets AS target_sheet
         ON target_sheet.event_id = app.event_id
        AND target_sheet.id = ?
       JOIN time_slots AS target_slot
         ON target_slot.event_id = target_sheet.event_id
        AND target_slot.roster_sheet_id = target_sheet.id
       JOIN events AS event
         ON event.id = app.event_id
       WHERE app.event_id = ?
         AND app.withdrawn = 0
         AND target_sheet.deleted_at IS NULL
         AND other_sheet.deleted_at IS NULL
         AND event.deleted_at IS NULL
         AND other_sheet.id <> target_sheet.id
         AND other_sheet.date = target_sheet.date
         AND target_slot.start_time < other_slot.end_time
         AND other_slot.start_time < target_slot.end_time
       ORDER BY app.id, target_slot.id`,
    )
    .bind(targetSheetId, eventId)
    .all<OverlappingAssignmentSlotRow>();

  const slotsByApplication = new Map<string, Set<string>>();
  for (const row of results ?? []) {
    const slots = slotsByApplication.get(row.application_id) ?? new Set<string>();
    slots.add(row.target_slot_id);
    slotsByApplication.set(row.application_id, slots);
  }
  return slotsByApplication;
}

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
