import type { RosterSheet } from "../roster-sheets/types";
import type { TimeSlot } from "../schedule/schedule.server";
import type { SlotRowCounts, slotDataLossOnSlotChange } from "./impact";

export async function listSlotDataCounts(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<{ availabilityCounts: SlotRowCounts; assignmentCounts: SlotRowCounts }> {
  const [availabilityRows, assignmentRows] = await Promise.all([
    db
      .prepare(
        `SELECT a.time_slot_id, COUNT(*) AS count
         FROM availabilities a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
         GROUP BY a.time_slot_id`,
      )
      .bind(eventId, sheetId)
      .all<{ time_slot_id: string; count: number }>(),
    db
      .prepare(
        `SELECT a.time_slot_id, COUNT(*) AS count
         FROM assignments a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
         GROUP BY a.time_slot_id`,
      )
      .bind(eventId, sheetId)
      .all<{ time_slot_id: string; count: number }>(),
  ]);
  return {
    availabilityCounts: Object.fromEntries(
      (availabilityRows.results ?? []).map((row) => [row.time_slot_id, row.count]),
    ),
    assignmentCounts: Object.fromEntries(
      (assignmentRows.results ?? []).map((row) => [row.time_slot_id, row.count]),
    ),
  };
}

type SlotDependentRowIds = {
  demands: { timeSlotId: string; trackId: string; roleId: string }[];
  availabilities: { timeSlotId: string; applicationId: string }[];
  assignments: { timeSlotId: string; applicationId: string }[];
};

export async function listSlotDependentRowIds(
  db: D1Database,
  eventId: string,
  sheetId: string,
): Promise<SlotDependentRowIds> {
  const [demands, availabilities, assignments] = await Promise.all([
    db
      .prepare(
        `SELECT time_slot_id, track_id, role_id FROM demands
         WHERE event_id = ? AND roster_sheet_id = ? AND ideal_count > 0
         ORDER BY time_slot_id, track_id, role_id`,
      )
      .bind(eventId, sheetId)
      .all<{ time_slot_id: string; track_id: string; role_id: string }>(),
    db
      .prepare(
        `SELECT a.time_slot_id, a.application_id FROM availabilities a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
         ORDER BY a.time_slot_id, a.application_id`,
      )
      .bind(eventId, sheetId)
      .all<{ time_slot_id: string; application_id: string }>(),
    db
      .prepare(
        `SELECT a.time_slot_id, a.application_id FROM assignments a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
         ORDER BY a.time_slot_id, a.application_id`,
      )
      .bind(eventId, sheetId)
      .all<{ time_slot_id: string; application_id: string }>(),
  ]);

  return {
    demands: (demands.results ?? []).map((row) => ({
      timeSlotId: row.time_slot_id,
      trackId: row.track_id,
      roleId: row.role_id,
    })),
    availabilities: (availabilities.results ?? []).map((row) => ({
      timeSlotId: row.time_slot_id,
      applicationId: row.application_id,
    })),
    assignments: (assignments.results ?? []).map((row) => ({
      timeSlotId: row.time_slot_id,
      applicationId: row.application_id,
    })),
  };
}

export function prepareSettingsAndSlotDataGuard(
  db: D1Database,
  eventId: string,
  sheet: RosterSheet,
  input: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    stepMin: number;
    maxConsecutive: number;
    noSoloNewcomer: boolean;
  },
  timeSlots: readonly TimeSlot[],
  impact: ReturnType<typeof slotDataLossOnSlotChange>,
  rowIds: SlotDependentRowIds,
): D1PreparedStatement[] {
  const removedSlotIds = new Set(impact.removedSlotIds);
  const removedRows = {
    demands: rowIds.demands.filter((row) => removedSlotIds.has(row.timeSlotId)),
    availabilities: rowIds.availabilities.filter((row) => removedSlotIds.has(row.timeSlotId)),
    assignments: rowIds.assignments.filter((row) => removedSlotIds.has(row.timeSlotId)),
  };
  const existingSlotSnapshot = JSON.stringify(
    timeSlots.map(({ id, idx, start, end, phaseId }) => ({ id, idx, start, end, phaseId })),
  );
  const removedSlotIdsJson = JSON.stringify(impact.removedSlotIds);
  const snapshotMatches = `
    name = ? AND date = ? AND start_time = ? AND end_time = ? AND step_min = ?
    AND max_consecutive = ? AND no_solo_newcomer = ?
    AND (SELECT COUNT(*) FROM time_slots
      WHERE event_id = ? AND roster_sheet_id = ?) = ?
    AND NOT EXISTS (
      SELECT 1 FROM time_slots AS ts
      WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS expected
          WHERE json_extract(expected.value, '$.id') = ts.id
            AND json_extract(expected.value, '$.idx') = ts.idx
            AND json_extract(expected.value, '$.start') = ts.start_time
            AND json_extract(expected.value, '$.end') = ts.end_time
            AND json_extract(expected.value, '$.phaseId') IS ts.phase_id
        )
    )
    AND (SELECT COUNT(*) FROM demands
      WHERE event_id = ? AND roster_sheet_id = ? AND ideal_count > 0
        AND time_slot_id IN (SELECT value FROM json_each(?))) = ?
    AND (SELECT COUNT(*) FROM availabilities AS a
      JOIN time_slots AS ts ON ts.id = a.time_slot_id
      WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
        AND ts.id IN (SELECT value FROM json_each(?))) = ?
    AND (SELECT COUNT(*) FROM assignments AS a
      JOIN time_slots AS ts ON ts.id = a.time_slot_id
      WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
        AND ts.id IN (SELECT value FROM json_each(?))) = ?
    AND NOT EXISTS (
      SELECT 1 FROM demands AS d
      WHERE d.event_id = ? AND d.roster_sheet_id = ? AND d.ideal_count > 0
        AND d.time_slot_id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS expected
          WHERE json_extract(expected.value, '$.timeSlotId') = d.time_slot_id
            AND json_extract(expected.value, '$.trackId') = d.track_id
            AND json_extract(expected.value, '$.roleId') = d.role_id
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM demands AS d
        WHERE d.event_id = ? AND d.roster_sheet_id = ? AND d.ideal_count > 0
          AND d.time_slot_id = json_extract(expected.value, '$.timeSlotId')
          AND d.track_id = json_extract(expected.value, '$.trackId')
          AND d.role_id = json_extract(expected.value, '$.roleId')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM availabilities AS a
      JOIN time_slots AS ts ON ts.id = a.time_slot_id
      WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
        AND ts.id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS expected
          WHERE json_extract(expected.value, '$.timeSlotId') = a.time_slot_id
            AND json_extract(expected.value, '$.applicationId') = a.application_id
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM availabilities AS a
        WHERE a.time_slot_id = json_extract(expected.value, '$.timeSlotId')
          AND a.application_id = json_extract(expected.value, '$.applicationId')
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM assignments AS a
      JOIN time_slots AS ts ON ts.id = a.time_slot_id
      WHERE ts.event_id = ? AND ts.roster_sheet_id = ?
        AND ts.id IN (SELECT value FROM json_each(?))
        AND NOT EXISTS (
          SELECT 1 FROM json_each(?) AS expected
          WHERE json_extract(expected.value, '$.timeSlotId') = a.time_slot_id
            AND json_extract(expected.value, '$.applicationId') = a.application_id
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM assignments AS a
        WHERE a.time_slot_id = json_extract(expected.value, '$.timeSlotId')
          AND a.application_id = json_extract(expected.value, '$.applicationId')
      )
    )
  `;
  const snapshotBindings = [
    sheet.name,
    sheet.date,
    sheet.startTime,
    sheet.endTime,
    sheet.stepMin,
    sheet.maxConsecutive,
    sheet.noSoloNewcomer ? 1 : 0,
    eventId,
    sheet.id,
    timeSlots.length,
    eventId,
    sheet.id,
    existingSlotSnapshot,
    eventId,
    sheet.id,
    removedSlotIdsJson,
    impact.lostDemandCount,
    eventId,
    sheet.id,
    removedSlotIdsJson,
    impact.lostAvailabilityCount,
    eventId,
    sheet.id,
    removedSlotIdsJson,
    impact.lostAssignmentCount,
    eventId,
    sheet.id,
    removedSlotIdsJson,
    JSON.stringify(removedRows.demands),
    JSON.stringify(removedRows.demands),
    eventId,
    sheet.id,
    eventId,
    sheet.id,
    removedSlotIdsJson,
    JSON.stringify(removedRows.availabilities),
    JSON.stringify(removedRows.availabilities),
    eventId,
    sheet.id,
    removedSlotIdsJson,
    JSON.stringify(removedRows.assignments),
    JSON.stringify(removedRows.assignments),
  ];
  const missingSheetGuard = db
    .prepare(
      `INSERT INTO roster_sheets
         (id, event_id, name, date, start_time, end_time, step_min, no_solo_newcomer,
          max_consecutive, seed, visibility, sort_order, created_at, updated_at)
       SELECT ?, ?, 'guard', '2000-01-01', '00:00', '00:15', 15, 0, 1, 0,
         'slot_data_loss_guard', 0, '', ''
       WHERE NOT EXISTS (
         SELECT 1 FROM roster_sheets WHERE id = ? AND event_id = ? AND deleted_at IS NULL
       )`,
    )
    .bind(crypto.randomUUID(), eventId, sheet.id, eventId);
  const guardedSettingsUpdate = db
    .prepare(
      `UPDATE roster_sheets
       SET name = CASE WHEN (${snapshotMatches}) THEN ? ELSE NULL END,
         date = ?, start_time = ?, end_time = ?, step_min = ?, no_solo_newcomer = ?,
         max_consecutive = ?, updated_at = ?
       WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(
      ...snapshotBindings,
      input.name,
      input.date,
      input.startTime,
      input.endTime,
      input.stepMin,
      input.noSoloNewcomer ? 1 : 0,
      input.maxConsecutive,
      new Date().toISOString(),
      sheet.id,
      eventId,
    );

  return [missingSheetGuard, guardedSettingsUpdate];
}

export function isSlotDataSnapshotConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("roster_sheets.name") ||
    error.message.includes("visibility IN ('private', 'published')")
  );
}
