import { getDefaultRosterSheet, getRosterSheet } from "../roster-sheets/roster-sheets.server";
import { reconcileSlotKeys } from "./reconcile";
import { type PhaseWindow, buildSlots } from "./slots";

/**
 * D1 access for `phases` and `time_slots` (docs/roster/02-domain-schema.md
 * "Design" §1, §3, §4). Tracks / roles / event_roles are a separate table
 * cluster with no idx-contiguity concern — see `./tracks.server`.
 *
 * `regenerateTimeSlots` is the one function every phase/schedule-settings
 * mutation ends in: it recomputes the full slot grid from `buildSlots` and
 * writes it back via `reconcileSlotKeys`'s keep/remove/insert diff, so a
 * time slot referenced by a later stage's `demands`/`availabilities` row
 * survives as long as its (start, end) key doesn't change.
 */

export type Phase = {
  id: string;
  eventId: string;
  name: string;
  from: string;
  to: string;
  sortOrder: number;
};

export type TimeSlot = {
  id: string;
  eventId: string;
  idx: number;
  start: string;
  end: string;
  phaseId: string | null;
};

type PhaseRow = {
  id: string;
  event_id: string;
  name: string;
  from_time: string;
  to_time: string;
  sort_order: number;
};

type TimeSlotRow = {
  id: string;
  event_id: string;
  idx: number;
  start_time: string;
  end_time: string;
  phase_id: string | null;
};

const PHASE_COLS = "id, event_id, name, from_time, to_time, sort_order";
const TIME_SLOT_COLS = "id, event_id, idx, start_time, end_time, phase_id";

async function resolveRosterSheetId(
  db: D1Database,
  eventId: string,
  rosterSheetId: string | undefined,
  required: boolean,
): Promise<string | null> {
  const sheet =
    rosterSheetId !== undefined
      ? await getRosterSheet(db, eventId, rosterSheetId)
      : await getDefaultRosterSheet(db, eventId);
  if (sheet) return sheet.id;
  if (rosterSheetId !== undefined) {
    throw new Error("Roster sheet does not belong to this event or is not live");
  }
  if (required) throw new Error("Event has no live roster sheet");
  return null;
}

export function toPhase(r: PhaseRow): Phase {
  return {
    id: r.id,
    eventId: r.event_id,
    name: r.name,
    from: r.from_time,
    to: r.to_time,
    sortOrder: r.sort_order,
  };
}

export function toTimeSlot(r: TimeSlotRow): TimeSlot {
  return {
    id: r.id,
    eventId: r.event_id,
    idx: r.idx,
    start: r.start_time,
    end: r.end_time,
    phaseId: r.phase_id,
  };
}

export async function listPhases(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<Phase[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, false);
  if (!sheetId) return [];
  const { results } = await db
    .prepare(
      `SELECT ${PHASE_COLS} FROM phases
       WHERE event_id = ? AND roster_sheet_id = ? ORDER BY sort_order`,
    )
    .bind(eventId, sheetId)
    .all<PhaseRow>();
  return (results ?? []).map(toPhase);
}

export type CreatePhaseInput = { name: string; from: string; to: string };

export async function createPhase(
  db: D1Database,
  eventId: string,
  input: CreatePhaseInput,
  rosterSheetId?: string,
): Promise<Phase> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  const { results } = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM phases
       WHERE event_id = ? AND roster_sheet_id = ?`,
    )
    .bind(eventId, sheetId)
    .all<{ next: number }>();
  const sortOrder = results?.[0]?.next ?? 0;

  const row = await db
    .prepare(
      `INSERT INTO phases (id, event_id, name, from_time, to_time, sort_order, roster_sheet_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${PHASE_COLS}`,
    )
    .bind(crypto.randomUUID(), eventId, input.name, input.from, input.to, sortOrder, sheetId)
    .first<PhaseRow>();
  if (!row) throw new Error("Phase insert returned no row");
  return toPhase(row);
}

/** Time slots referencing this phase fall back to phase_id = NULL (ON DELETE SET NULL). */
export async function deletePhase(
  db: D1Database,
  id: string,
  eventId: string,
  rosterSheetId?: string,
): Promise<void> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  await db
    .prepare("DELETE FROM phases WHERE id = ? AND event_id = ? AND roster_sheet_id = ?")
    .bind(id, eventId, sheetId)
    .run();
}

export async function listTimeSlots(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<TimeSlot[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, false);
  if (!sheetId) return [];
  const { results } = await db
    .prepare(
      `SELECT ${TIME_SLOT_COLS} FROM time_slots
       WHERE event_id = ? AND roster_sheet_id = ? ORDER BY idx`,
    )
    .bind(eventId, sheetId)
    .all<TimeSlotRow>();
  return (results ?? []).map(toTimeSlot);
}

/**
 * Rebuilds `time_slots` for `range`/`phases` and reconciles it against what's
 * already stored. Uses a two-phase idx update (offset every kept row far out
 * of range, then settle each to its final idx) because `UNIQUE(roster_sheet_id,
 * idx)` is checked per-statement, not deferred — a direct old-idx ->
 * new-idx UPDATE can transiently collide with a sibling row that hasn't
 * moved yet (e.g. a swap). Offsetting first guarantees no kept row is ever
 * sitting in the 0..N-1 target range while any UPDATE runs.
 */
export async function regenerateTimeSlots(
  db: D1Database,
  eventId: string,
  range: { start: string; end: string; stepMin: number },
  phases: readonly PhaseWindow[],
  rosterSheetId?: string,
): Promise<TimeSlot[]> {
  const sheetId = await resolveRosterSheetId(db, eventId, rosterSheetId, true);
  if (!sheetId) throw new Error("Event has no live roster sheet");
  const phaseIds = [...new Set(phases.map((phase) => phase.id))];
  if (phaseIds.length > 0) {
    const placeholders = phaseIds.map(() => "?").join(", ");
    const { results: phaseRows } = await db
      .prepare(
        `SELECT id FROM phases
         WHERE event_id = ? AND roster_sheet_id = ? AND id IN (${placeholders})`,
      )
      .bind(eventId, sheetId, ...phaseIds)
      .all<{ id: string }>();
    if ((phaseRows ?? []).length !== phaseIds.length) {
      throw new Error("Every phase must belong to the selected roster sheet");
    }
  }
  const existingRows =
    (
      await db
        .prepare(
          `SELECT ${TIME_SLOT_COLS} FROM time_slots
           WHERE event_id = ? AND roster_sheet_id = ?`,
        )
        .bind(eventId, sheetId)
        .all<TimeSlotRow>()
    ).results ?? [];
  const existing = existingRows.map((r) => ({ id: r.id, start: r.start_time, end: r.end_time }));

  const next = buildSlots(range, phases);
  const { keep, remove, insert } = reconcileSlotKeys(
    existing,
    next.map((s) => ({ start: s.start, end: s.end })),
  );

  const keepIdByKey = new Map(keep.map((s) => [`${s.start}-${s.end}`, s.id]));
  const insertKeys = new Set(insert.map((s) => `${s.start}-${s.end}`));
  const statements: D1PreparedStatement[] = [];

  const OFFSET = 1_000_000;
  if (keep.length > 0) {
    const placeholders = keep.map(() => "?").join(", ");
    statements.push(
      db
        .prepare(
          `UPDATE time_slots SET idx = idx + ${OFFSET}
           WHERE event_id = ? AND roster_sheet_id = ? AND id IN (${placeholders})`,
        )
        .bind(eventId, sheetId, ...keep.map((s) => s.id)),
    );
  }

  if (remove.length > 0) {
    const placeholders = remove.map(() => "?").join(", ");
    statements.push(
      db
        .prepare(
          `DELETE FROM time_slots
           WHERE event_id = ? AND roster_sheet_id = ? AND id IN (${placeholders})`,
        )
        .bind(eventId, sheetId, ...remove),
    );
  }

  for (const slot of next) {
    const key = `${slot.start}-${slot.end}`;
    const keptId = keepIdByKey.get(key);
    if (keptId) {
      statements.push(
        db
          .prepare(
            `UPDATE time_slots SET idx = ?, phase_id = ?
             WHERE id = ? AND event_id = ? AND roster_sheet_id = ?`,
          )
          .bind(slot.idx, slot.phaseId, keptId, eventId, sheetId),
      );
    } else if (insertKeys.has(key)) {
      statements.push(
        db
          .prepare(
            `INSERT INTO time_slots
               (id, event_id, idx, start_time, end_time, phase_id, roster_sheet_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            eventId,
            slot.idx,
            slot.start,
            slot.end,
            slot.phaseId,
            sheetId,
          ),
      );
    }
  }

  if (statements.length > 0) await db.batch(statements);
  return listTimeSlots(db, eventId, sheetId);
}
