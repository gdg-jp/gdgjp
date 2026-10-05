import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";
import type { Demand, DemandValue } from "./types";

/**
 * Row/column assembly for the demand matrix on `/e/:id/design`
 * (docs/roster/03-demand-input.md "Design" §3, §4). Pure — no D1, no React.
 *
 * Two axes are independent of each other:
 *  - **Columns** — the (track, role) pairs that have at least one real
 *    demand row. Showing every possible combination would be unreadable
 *    (§3(c): "6 役割 × 4 トラック = 24 列を全部出すと読めない").
 *  - **Rows** — either one row per phase (writing to a phase-row cell
 *    fans the same value out to every time slot in that phase) or one row
 *    per time slot (§3(a)).
 */

export type MatrixMode = "phase" | "slot";

export type DemandColumn = { trackId: string; roleId: string };

export function columnKey(trackId: string, roleId: string): string {
  return `${trackId}:${roleId}`;
}

/** Synthetic phase-row key for time slots with `phaseId === null` (Stage 02 allows this). */
export const UNPHASED_ROW_KEY = "__unphased__";

const ZERO_VALUE: DemandValue = { min: 0, ideal: 0, leadMin: 0, newMax: 0 };

/**
 * `ideal === 0` and "no row" are the same "no demand" state (types.ts
 * module doc) — collapse both to the same zero value before any comparison
 * so uniformity/emptiness checks don't have to special-case which form a
 * given slot happens to be in.
 */
function demandValue(d: Demand | undefined): DemandValue {
  if (!d || d.ideal === 0) return ZERO_VALUE;
  return { min: d.min, ideal: d.ideal, leadMin: d.leadMin, newMax: d.newMax };
}

function sameValue(a: DemandValue, b: DemandValue): boolean {
  return a.min === b.min && a.ideal === b.ideal && a.leadMin === b.leadMin && a.newMax === b.newMax;
}

export type MatrixCell =
  | { kind: "empty" }
  | { kind: "value"; value: DemandValue; uniform: boolean };

export type MatrixRow = {
  key: string;
  label: string;
  /** Time slots a write to this row's cells fans out to (1 element for a slot row). */
  timeSlotIds: string[];
  cells: Map<string, MatrixCell>;
};

type SortableTrack = { id: string; sortOrder: number };
type SortableRole = { id: string; sortOrder: number };

/** Only the (track, role) pairs with at least one `ideal > 0` demand row, ordered by track then role sort order. */
export function buildColumns(
  demands: readonly Demand[],
  tracks: readonly SortableTrack[],
  roles: readonly SortableRole[],
): DemandColumn[] {
  const trackOrder = new Map(tracks.map((t) => [t.id, t.sortOrder]));
  const roleOrder = new Map(roles.map((r) => [r.id, r.sortOrder]));

  const seen = new Map<string, DemandColumn>();
  for (const d of demands) {
    if (d.ideal <= 0) continue;
    const key = columnKey(d.trackId, d.roleId);
    if (!seen.has(key)) seen.set(key, { trackId: d.trackId, roleId: d.roleId });
  }

  return [...seen.values()].sort((a, b) => {
    const trackDiff =
      (trackOrder.get(a.trackId) ?? Number.POSITIVE_INFINITY) -
      (trackOrder.get(b.trackId) ?? Number.POSITIVE_INFINITY);
    if (trackDiff !== 0) return trackDiff;
    return (
      (roleOrder.get(a.roleId) ?? Number.POSITIVE_INFINITY) -
      (roleOrder.get(b.roleId) ?? Number.POSITIVE_INFINITY)
    );
  });
}

function indexDemandsBySlot(demands: readonly Demand[]): Map<string, Map<string, Demand>> {
  const bySlot = new Map<string, Map<string, Demand>>();
  for (const d of demands) {
    let inner = bySlot.get(d.timeSlotId);
    if (!inner) {
      inner = new Map();
      bySlot.set(d.timeSlotId, inner);
    }
    inner.set(columnKey(d.trackId, d.roleId), d);
  }
  return bySlot;
}

/** One row per time slot — editing a cell here overwrites only that slot (docs/roster/03-demand-input.md "Design" §3(a)). */
export function buildSlotRows(
  timeSlots: readonly TimeSlot[],
  demands: readonly Demand[],
  columns: readonly DemandColumn[],
): MatrixRow[] {
  const bySlot = indexDemandsBySlot(demands);
  return timeSlots.map((slot) => {
    const inner = bySlot.get(slot.id);
    const cells = new Map<string, MatrixCell>();
    for (const col of columns) {
      const key = columnKey(col.trackId, col.roleId);
      const value = demandValue(inner?.get(key));
      cells.set(
        key,
        value.ideal === 0 ? { kind: "empty" } : { kind: "value", value, uniform: true },
      );
    }
    return { key: slot.id, label: `${slot.start}–${slot.end}`, timeSlotIds: [slot.id], cells };
  });
}

function buildPhaseRow(
  key: string,
  label: string,
  slots: readonly TimeSlot[],
  bySlot: Map<string, Map<string, Demand>>,
  columns: readonly DemandColumn[],
): MatrixRow {
  const cells = new Map<string, MatrixCell>();
  for (const col of columns) {
    const colKey = columnKey(col.trackId, col.roleId);
    const values = slots.map((s) => demandValue(bySlot.get(s.id)?.get(colKey)));
    if (values.every((v) => v.ideal === 0)) {
      cells.set(colKey, { kind: "empty" });
      continue;
    }
    // Representative value shown on the phase row: the first slot's value.
    // `uniform` (not this choice of representative) is what callers must
    // check before trusting it applies to every slot in the phase.
    const representative = values[0] ?? ZERO_VALUE;
    const uniform = values.every((v) => sameValue(v, representative));
    cells.set(colKey, { kind: "value", value: representative, uniform });
  }
  return { key, label, timeSlotIds: slots.map((s) => s.id), cells };
}

/**
 * One row per phase — editing a cell here fans the value out to every time
 * slot in that phase (docs/roster/03-demand-input.md "Design" §3(a)). A
 * cell shows `uniform: false` when the phase's slots disagree, which the
 * UI renders as a `*` suffix (§3(a), §Verification #3).
 *
 * Slots with `phaseId === null` (Stage 02 allows this) are grouped into a
 * trailing synthetic row keyed `UNPHASED_ROW_KEY` so their demand stays
 * visible and editable in phase view, rather than disappearing silently.
 */
export function buildPhaseRows(
  phases: readonly Phase[],
  timeSlots: readonly TimeSlot[],
  demands: readonly Demand[],
  columns: readonly DemandColumn[],
): MatrixRow[] {
  const bySlot = indexDemandsBySlot(demands);
  const slotsByPhase = new Map<string | null, TimeSlot[]>();
  for (const slot of timeSlots) {
    const list = slotsByPhase.get(slot.phaseId) ?? [];
    list.push(slot);
    slotsByPhase.set(slot.phaseId, list);
  }

  const rows = phases.map((phase) =>
    buildPhaseRow(phase.id, phase.name, slotsByPhase.get(phase.id) ?? [], bySlot, columns),
  );

  const unphased = slotsByPhase.get(null) ?? [];
  if (unphased.length > 0) {
    rows.push(buildPhaseRow(UNPHASED_ROW_KEY, "フェーズ未設定", unphased, bySlot, columns));
  }
  return rows;
}

/** Expands a clicked row + mode into the concrete time slots a write should fan out to — used by the route action to build a bulk write. */
export function timeSlotIdsForTarget(
  mode: MatrixMode,
  rowKey: string,
  timeSlots: readonly TimeSlot[],
): string[] {
  if (mode === "slot") return [rowKey];
  if (rowKey === UNPHASED_ROW_KEY) {
    return timeSlots.filter((s) => s.phaseId === null).map((s) => s.id);
  }
  return timeSlots.filter((s) => s.phaseId === rowKey).map((s) => s.id);
}
