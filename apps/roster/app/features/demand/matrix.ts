import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";
import type { Demand, DemandValue } from "./types";

export type MatrixMode = "phase" | "slot";

export type DemandColumn = { trackId: string; roleId: string };

export function columnKey(trackId: string, roleId: string): string {
  return `${trackId}:${roleId}`;
}

export const UNPHASED_ROW_KEY = "__unphased__";

const ZERO_VALUE: DemandValue = { min: 0, ideal: 0, leadMin: 0, newMax: 0 };

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
  timeSlotIds: string[];
  cells: Map<string, MatrixCell>;
};

type SortableTrack = { id: string; sortOrder: number };
type SortableRole = { id: string; sortOrder: number };

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
    const representative = values[0] ?? ZERO_VALUE;
    const uniform = values.every((v) => sameValue(v, representative));
    cells.set(colKey, { kind: "value", value: representative, uniform });
  }
  return { key, label, timeSlotIds: slots.map((s) => s.id), cells };
}

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
