import { getDefaultRosterSheet, getRosterSheet } from "../roster-sheets/roster-sheets.server";
import type { Demand } from "./types";
import { validateDemand } from "./validate";

type DemandRow = {
  event_id: string;
  time_slot_id: string;
  track_id: string;
  role_id: string;
  min_count: number;
  ideal_count: number;
  lead_min: number;
  new_max: number;
};

const DEMAND_COLS =
  "event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max";

export function toDemand(r: DemandRow): Demand {
  return {
    timeSlotId: r.time_slot_id,
    trackId: r.track_id,
    roleId: r.role_id,
    min: r.min_count,
    ideal: r.ideal_count,
    leadMin: r.lead_min,
    newMax: r.new_max,
  };
}

export function demandOrNull(row: DemandRow | null): Demand | null {
  if (!row || row.ideal_count <= 0) return null;
  return toDemand(row);
}

async function resolveRosterSheetId(
  db: D1Database,
  eventId: string,
  rosterSheetId: string | undefined,
  required: boolean,
): Promise<string | null> {
  const sheet = rosterSheetId
    ? await getRosterSheet(db, eventId, rosterSheetId)
    : await getDefaultRosterSheet(db, eventId);
  if (sheet) return sheet.id;
  if (rosterSheetId !== undefined) {
    throw new Error("Roster sheet does not belong to this event or is not live");
  }
  if (required) throw new Error("Event has no live roster sheet");
  return null;
}

/** Demand rows from one live sheet. Event-only callers use its default sheet. */
export async function listDemandsForEvent(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<Demand[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, false);
  if (!sheetId) return [];
  const { results } = await db
    .prepare(
      `SELECT ${DEMAND_COLS} FROM demands
       WHERE event_id = ? AND roster_sheet_id = ? AND ideal_count > 0`,
    )
    .bind(eventId, sheetId)
    .all<DemandRow>();
  return (results ?? []).map(toDemand);
}

/** Explicitly named alias for call sites already operating on a selected sheet. */
export function listDemandsForRosterSheet(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
): Promise<Demand[]> {
  return listDemandsForEvent(db, eventId, rosterSheetId);
}

/**
 * Get one cell from the slot's event's live default sheet, or from the
 * explicitly supplied live sheet. The slot itself must belong to that sheet.
 */
export async function getDemand(
  db: D1Database,
  timeSlotId: string,
  trackId: string,
  roleId: string,
  rosterSheetId?: string,
): Promise<Demand | null> {
  const slot = await db
    .prepare("SELECT event_id FROM time_slots WHERE id = ?")
    .bind(timeSlotId)
    .first<{ event_id: string }>();
  if (!slot) return null;
  const sheetId = await resolveRosterSheetId(db, slot.event_id, rosterSheetId, false);
  if (!sheetId) return null;
  const row = await db
    .prepare(
      `SELECT ${DEMAND_COLS} FROM demands AS d
       WHERE d.event_id = ? AND d.roster_sheet_id = ?
         AND d.time_slot_id = ? AND d.track_id = ? AND d.role_id = ?
         AND EXISTS (
           SELECT 1 FROM time_slots ts
           WHERE ts.id = d.time_slot_id AND ts.event_id = d.event_id
             AND ts.roster_sheet_id = d.roster_sheet_id
         )
         AND EXISTS (
           SELECT 1 FROM tracks t
           WHERE t.id = d.track_id AND t.event_id = d.event_id
             AND t.roster_sheet_id = d.roster_sheet_id
         )
         AND EXISTS (
           SELECT 1 FROM roster_sheet_roles rsr
           WHERE rsr.roster_sheet_id = d.roster_sheet_id AND rsr.role_id = d.role_id
         )`,
    )
    .bind(slot.event_id, sheetId, timeSlotId, trackId, roleId)
    .first<DemandRow>();
  return demandOrNull(row);
}

export class DemandValidationFailure extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`Invalid demand value: ${errors.join(", ")}`);
    this.name = "DemandValidationFailure";
  }
}

export class DemandTargetFailure extends Error {
  constructor() {
    super("Time slot, track, and role must belong to the selected live roster sheet");
    this.name = "DemandTargetFailure";
  }
}

async function validateTargets(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  inputs: readonly Demand[],
): Promise<void> {
  for (const input of inputs) {
    const row = await db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM time_slots WHERE id = ? AND event_id = ? AND roster_sheet_id = ?) AS has_slot,
           EXISTS (SELECT 1 FROM tracks WHERE id = ? AND event_id = ? AND roster_sheet_id = ?) AS has_track,
           EXISTS (SELECT 1 FROM roster_sheet_roles WHERE roster_sheet_id = ? AND role_id = ?) AS has_role`,
      )
      .bind(
        input.timeSlotId,
        eventId,
        rosterSheetId,
        input.trackId,
        eventId,
        rosterSheetId,
        rosterSheetId,
        input.roleId,
      )
      .first<{ has_slot: number; has_track: number; has_role: number }>();
    if (!row || row.has_slot !== 1 || row.has_track !== 1 || row.has_role !== 1) {
      throw new DemandTargetFailure();
    }
  }
}

function demandStatement(
  db: D1Database,
  eventId: string,
  rosterSheetId: string,
  input: Demand,
): D1PreparedStatement {
  const scopeExists = `
    EXISTS (SELECT 1 FROM time_slots WHERE id = ? AND event_id = ? AND roster_sheet_id = ?)
    AND EXISTS (SELECT 1 FROM tracks WHERE id = ? AND event_id = ? AND roster_sheet_id = ?)
    AND EXISTS (SELECT 1 FROM roster_sheet_roles WHERE roster_sheet_id = ? AND role_id = ?)`;
  const scopeBindings = [
    input.timeSlotId,
    eventId,
    rosterSheetId,
    input.trackId,
    eventId,
    rosterSheetId,
    rosterSheetId,
    input.roleId,
  ];

  if (input.ideal === 0) {
    // Scope both the target lookup and DELETE. If a referenced row changes
    // after validation, this guarded statement safely becomes a no-op.
    return db
      .prepare(
        `DELETE FROM demands
         WHERE event_id = ? AND roster_sheet_id = ?
           AND time_slot_id = ? AND track_id = ? AND role_id = ?
           AND ${scopeExists}`,
      )
      .bind(
        eventId,
        rosterSheetId,
        input.timeSlotId,
        input.trackId,
        input.roleId,
        ...scopeBindings,
      );
  }
  return db
    .prepare(
      `INSERT INTO demands
         (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max, roster_sheet_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${scopeExists}
       ON CONFLICT (time_slot_id, track_id, role_id) DO UPDATE SET
         min_count = excluded.min_count,
         ideal_count = excluded.ideal_count,
         lead_min = excluded.lead_min,
         new_max = excluded.new_max
       WHERE demands.event_id = excluded.event_id
         AND demands.roster_sheet_id = excluded.roster_sheet_id`,
    )
    .bind(
      eventId,
      input.timeSlotId,
      input.trackId,
      input.roleId,
      input.min,
      input.ideal,
      input.leadMin,
      input.newMax,
      rosterSheetId,
      ...scopeBindings,
    );
}

/** Writes all entries atomically, rejecting invalid values or cross-sheet targets. */
export async function bulkUpsertDemands(
  db: D1Database,
  eventId: string,
  inputs: readonly Demand[],
  rosterSheetId?: string,
): Promise<void> {
  const errorCodes = new Set(inputs.flatMap((input) => validateDemand(input)));
  if (errorCodes.size > 0) throw new DemandValidationFailure([...errorCodes]);
  if (inputs.length === 0) return;
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  await validateTargets(db, eventId, sheetId, inputs);
  await db.batch(inputs.map((input) => demandStatement(db, eventId, sheetId, input)));
}

export async function upsertDemand(
  db: D1Database,
  eventId: string,
  input: Demand,
  rosterSheetId?: string,
): Promise<void> {
  await bulkUpsertDemands(db, eventId, [input], rosterSheetId);
}

/** Explicit sheet-scoped deletion API for call sites that do not use ideal=0. */
export async function deleteDemand(
  db: D1Database,
  eventId: string,
  timeSlotId: string,
  trackId: string,
  roleId: string,
  rosterSheetId?: string,
): Promise<void> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  const target = { timeSlotId, trackId, roleId, min: 0, ideal: 0, leadMin: 0, newMax: 0 };
  await validateTargets(db, eventId, sheetId, [target]);
  await db.batch([demandStatement(db, eventId, sheetId, target)]);
}
