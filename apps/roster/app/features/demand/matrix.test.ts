import { describe, expect, it } from "vitest";
import type { Phase, TimeSlot } from "~/features/schedule/schedule.server";
import {
  UNPHASED_ROW_KEY,
  buildColumns,
  buildPhaseRows,
  buildSlotRows,
  columnKey,
  timeSlotIdsForTarget,
} from "./matrix";
import type { Demand } from "./types";

const TRACKS = [
  { id: "trk_shared", sortOrder: 0 },
  { id: "trk_a", sortOrder: 1 },
  { id: "trk_b", sortOrder: 2 },
];
const ROLES = [
  { id: "reception", sortOrder: 1 },
  { id: "stream", sortOrder: 4 },
];

function slot(id: string, idx: number, phaseId: string | null): TimeSlot {
  return { id, eventId: "evt_1", idx, start: `0${9 + idx}:00`, end: `0${10 + idx}:00`, phaseId };
}

function demand(overrides: Partial<Demand>): Demand {
  return {
    timeSlotId: "slot_1",
    trackId: "trk_shared",
    roleId: "reception",
    min: 1,
    ideal: 2,
    leadMin: 0,
    newMax: 99,
    ...overrides,
  };
}

describe("buildColumns", () => {
  it("only includes (track, role) pairs with at least one ideal > 0 demand", () => {
    const demands = [
      demand({ trackId: "trk_shared", roleId: "reception", ideal: 4 }),
      demand({ trackId: "trk_a", roleId: "stream", ideal: 0, min: 0, leadMin: 0, newMax: 0 }),
    ];
    const columns = buildColumns(demands, TRACKS, ROLES);
    expect(columns).toEqual([{ trackId: "trk_shared", roleId: "reception" }]);
  });

  /**
   * docs/roster/03-demand-input.md "回帰として固定すべきテスト": a
   * (track, role) pair with no demand anywhere must never appear as a
   * column, or 6 roles x 4 tracks worth of empty columns make the matrix
   * unreadable.
   */
  it("never emits a column for a (track, role) pair with no demand", () => {
    const columns = buildColumns([], TRACKS, ROLES);
    expect(columns).toEqual([]);
  });

  it("sorts by track sort order then role sort order", () => {
    const demands = [
      demand({ trackId: "trk_b", roleId: "reception" }),
      demand({ trackId: "trk_shared", roleId: "stream" }),
      demand({ trackId: "trk_shared", roleId: "reception" }),
    ];
    const columns = buildColumns(demands, TRACKS, ROLES);
    expect(columns).toEqual([
      { trackId: "trk_shared", roleId: "reception" },
      { trackId: "trk_shared", roleId: "stream" },
      { trackId: "trk_b", roleId: "reception" },
    ]);
  });

  it("deduplicates a (track, role) pair that appears in multiple demand rows", () => {
    const demands = [
      demand({ timeSlotId: "slot_1" }),
      demand({ timeSlotId: "slot_2" }),
      demand({ timeSlotId: "slot_3" }),
    ];
    expect(buildColumns(demands, TRACKS, ROLES)).toHaveLength(1);
  });
});

describe("buildSlotRows", () => {
  const slots = [slot("slot_1", 0, "phase_1"), slot("slot_2", 1, "phase_1")];
  const columns = [{ trackId: "trk_shared", roleId: "reception" }];

  it("returns one row per time slot with an empty cell where no demand exists", () => {
    const rows = buildSlotRows(slots, [], columns);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.get(columnKey("trk_shared", "reception"))).toEqual({ kind: "empty" });
  });

  it("returns a value cell (always uniform: true — a slot row has only one slot) when demand exists", () => {
    const rows = buildSlotRows(
      slots,
      [demand({ timeSlotId: "slot_1", min: 3, ideal: 4, leadMin: 1, newMax: 2 })],
      columns,
    );
    expect(rows[0].cells.get(columnKey("trk_shared", "reception"))).toEqual({
      kind: "value",
      value: { min: 3, ideal: 4, leadMin: 1, newMax: 2 },
      uniform: true,
    });
    expect(rows[1].cells.get(columnKey("trk_shared", "reception"))).toEqual({ kind: "empty" });
  });

  it("treats an ideal=0 row the same as no row", () => {
    const rows = buildSlotRows(
      slots,
      [demand({ timeSlotId: "slot_1", ideal: 0, min: 0, leadMin: 0, newMax: 0 })],
      columns,
    );
    expect(rows[0].cells.get(columnKey("trk_shared", "reception"))).toEqual({ kind: "empty" });
  });
});

describe("buildPhaseRows", () => {
  const phases: Phase[] = [
    { id: "phase_1", eventId: "evt_1", name: "開場前", from: "09:00", to: "10:00", sortOrder: 0 },
  ];
  const columns = [{ trackId: "trk_shared", roleId: "reception" }];

  it("reports uniform: true when every slot in the phase agrees", () => {
    const slots = [slot("slot_1", 0, "phase_1"), slot("slot_2", 1, "phase_1")];
    const demands = [
      demand({ timeSlotId: "slot_1", min: 3, ideal: 4, leadMin: 1, newMax: 2 }),
      demand({ timeSlotId: "slot_2", min: 3, ideal: 4, leadMin: 1, newMax: 2 }),
    ];
    const rows = buildPhaseRows(phases, slots, demands, columns);
    const cell = rows[0].cells.get(columnKey("trk_shared", "reception"));
    expect(cell).toMatchObject({ kind: "value", uniform: true });
  });

  /**
   * docs/roster/03-demand-input.md "回帰として固定すべきテスト": this is
   * the exact scenario from the stage's manual E2E (step 5-6) — override
   * one time slot away from the phase-wide value, then the phase-row cell
   * must flag it as `uniform: false` (rendered as a `*` in the UI) so the
   * owner doesn't silently clobber the per-slot override on their next
   * phase-wide edit.
   */
  it("reports uniform: false when exactly one slot in the phase was overridden individually", () => {
    const slots = [slot("slot_1", 0, "phase_1"), slot("slot_2", 1, "phase_1")];
    const demands = [
      demand({ timeSlotId: "slot_1", min: 3, ideal: 4, leadMin: 1, newMax: 2 }),
      demand({ timeSlotId: "slot_2", min: 1, ideal: 2, leadMin: 0, newMax: 99 }),
    ];
    const rows = buildPhaseRows(phases, slots, demands, columns);
    const cell = rows[0].cells.get(columnKey("trk_shared", "reception"));
    expect(cell).toMatchObject({ kind: "value", uniform: false });
  });

  it("treats a slot with no row and a slot with ideal=0 as agreeing (both are 'no demand')", () => {
    const slots = [slot("slot_1", 0, "phase_1"), slot("slot_2", 1, "phase_1")];
    const demands = [demand({ timeSlotId: "slot_1", ideal: 0, min: 0, leadMin: 0, newMax: 0 })];
    const rows = buildPhaseRows(phases, slots, demands, columns);
    expect(rows[0].cells.get(columnKey("trk_shared", "reception"))).toEqual({ kind: "empty" });
  });

  it("groups time slots with no phase into a trailing UNPHASED_ROW_KEY row", () => {
    const slots = [slot("slot_1", 0, "phase_1"), slot("slot_2", 1, null)];
    const demands = [demand({ timeSlotId: "slot_2", min: 1, ideal: 1, leadMin: 0, newMax: 99 })];
    const rows = buildPhaseRows(phases, slots, demands, columns);
    expect(rows).toHaveLength(2);
    expect(rows[1].key).toBe(UNPHASED_ROW_KEY);
    expect(rows[1].timeSlotIds).toEqual(["slot_2"]);
  });

  it("omits the unphased row entirely when every slot has a phase", () => {
    const slots = [slot("slot_1", 0, "phase_1")];
    const rows = buildPhaseRows(phases, slots, [], columns);
    expect(rows.map((r) => r.key)).toEqual(["phase_1"]);
  });
});

describe("timeSlotIdsForTarget", () => {
  const slots = [
    slot("slot_1", 0, "phase_1"),
    slot("slot_2", 1, "phase_1"),
    slot("slot_3", 2, null),
  ];

  it("returns just the one slot id in slot mode", () => {
    expect(timeSlotIdsForTarget("slot", "slot_2", slots)).toEqual(["slot_2"]);
  });

  it("returns every slot in the phase in phase mode", () => {
    expect(timeSlotIdsForTarget("phase", "phase_1", slots)).toEqual(["slot_1", "slot_2"]);
  });

  it("returns every unphased slot for the synthetic UNPHASED_ROW_KEY", () => {
    expect(timeSlotIdsForTarget("phase", UNPHASED_ROW_KEY, slots)).toEqual(["slot_3"]);
  });
});
