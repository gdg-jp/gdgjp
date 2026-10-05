import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { type Assignments, assignmentKey } from "~/features/solver/types";
import type { AssignmentRecord } from "./types";

type AssignmentRow = {
  event_id: string;
  roster_sheet_id: string | null;
  application_id: string;
  time_slot_id: string;
  track_id: string;
  role_id: string;
  locked: number;
};

function toAssignment(r: AssignmentRow): AssignmentRecord {
  return {
    eventId: r.event_id,
    rosterSheetId: r.roster_sheet_id ?? `default:${r.event_id}`,
    applicationId: r.application_id,
    timeSlotId: r.time_slot_id,
    trackId: r.track_id,
    roleId: r.role_id,
    locked: r.locked === 1,
  };
}

/** Reads one sheet's assignments, ordered for grid consumers. */
export async function readAssignments(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<AssignmentRecord[]> {
  const sheet =
    rosterSheetId !== undefined
      ? await getRosterSheet(db, eventId, rosterSheetId)
      : await getDefaultRosterSheet(db, eventId);
  if (!sheet) {
    if (rosterSheetId !== undefined) throw new Error("Roster sheet not found for this event.");
    return [];
  }
  const { results } = await db
    .prepare(
      `SELECT a.event_id, a.roster_sheet_id, a.application_id, a.time_slot_id,
              a.track_id, a.role_id, a.locked
       FROM assignments a
       JOIN roster_sheets s ON s.id = a.roster_sheet_id AND s.event_id = a.event_id
       JOIN events e ON e.id = a.event_id
       WHERE a.event_id = ? AND a.roster_sheet_id = ?
         AND s.deleted_at IS NULL AND e.deleted_at IS NULL
       ORDER BY a.time_slot_id, a.application_id`,
    )
    .bind(eventId, sheet.id)
    .all<AssignmentRow>();
  return (results ?? []).map(toAssignment);
}

/** `readAssignments`, reshaped into the solver's own `Assignments` Map. */
export async function readAssignmentsMap(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<Assignments> {
  const rows = await readAssignments(db, eventId, rosterSheetId);
  const map: Assignments = new Map();
  for (const row of rows) {
    map.set(assignmentKey(row.applicationId, row.timeSlotId), {
      trackId: row.trackId,
      roleId: row.roleId,
      locked: row.locked,
    });
  }
  return map;
}

export { toAssignment };
