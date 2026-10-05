import { describe, expect, it } from "vitest";
import { orderDemandCells } from "./scarcity";
import { type SolverApplication, type SolverInput, demandKey } from "./types";

const ROLE = "reception";
const TRACK = "track-a";

function makeApp(id: string, overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id,
    withdrawn: false,
    skills: { [ROLE]: { level: "exp", pref: 2 } },
    availability: { "slot-0": "o", "slot-1": "o" },
    ...overrides,
  };
}

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    slots: [
      { id: "slot-0", idx: 0 },
      { id: "slot-1", idx: 1 },
    ],
    tracks: [{ id: TRACK }],
    roles: [{ id: ROLE }],
    demands: new Map(),
    applications: [],
    options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
    ...overrides,
  };
}

describe("orderDemandCells", () => {
  it("drops cells with ideal === 0 (same as no row, index.md §4)", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 0, ideal: 0, leadMin: 0, newMax: 0 }],
      ]),
      applications: [makeApp("a1")],
    });
    expect(orderDemandCells(input)).toEqual([]);
  });

  it("sorts scarcer cells (fewer eligible people relative to min) before easier ones", () => {
    const input = baseInput({
      demands: new Map([
        // easy: 3 eligible people, min 1 -> scarcity very negative (low)... wait, compute below
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
        [demandKey("slot-1", TRACK, ROLE), { min: 3, ideal: 3, leadMin: 0, newMax: 5 }],
      ]),
      applications: [makeApp("a1"), makeApp("a2"), makeApp("a3")],
    });
    const ordered = orderDemandCells(input);
    expect(ordered).toHaveLength(2);
    // slot-1 needs 3 of the same 3 eligible people (scarcity = 3-3+5=5)
    // slot-0 needs 1 of the same 3 eligible people (scarcity = 3-1+5=7)
    // -> slot-1 is scarcer and sorts first.
    expect(ordered[0].slotId).toBe("slot-1");
    expect(ordered[1].slotId).toBe("slot-0");
  });

  it("excludes withdrawn, skill-less, and unavailable ('x') people from the eligible count", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [
        makeApp("withdrawn", { withdrawn: true }),
        makeApp("no-skill", { skills: {} }),
        makeApp("unavailable", { availability: { "slot-0": "x" } }),
        makeApp("eligible"),
      ],
    });
    const [cell] = orderDemandCells(input);
    // scarcity = eligible(1) - min(1) + leadPressure(5, since leadMin=0) = 5
    expect(cell).toBeDefined();
  });

  it("gives leadMin === 0 cells a fixed pressure of 5 so they sort after leadMin > 0 cells, all else equal", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
        [demandKey("slot-1", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 1, newMax: 5 }],
      ]),
      applications: [makeApp("a1", { skills: { [ROLE]: { level: "lead", pref: 2 } } })],
    });
    const ordered = orderDemandCells(input);
    // slot-1: eligible=1, leads=1, leadMin=1 -> leadPressure=(1-1)*0.5=0 -> scarcity=1-1+0=0
    // slot-0: eligible=1, leadMin=0 -> leadPressure=5 -> scarcity=1-1+5=5
    expect(ordered[0].slotId).toBe("slot-1");
    expect(ordered[1].slotId).toBe("slot-0");
  });

  it("breaks ties by slot idx ascending", () => {
    const input = baseInput({
      slots: [
        { id: "slot-9", idx: 9 },
        { id: "slot-2", idx: 2 },
      ],
      demands: new Map([
        [demandKey("slot-9", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
        [demandKey("slot-2", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [makeApp("a1", { availability: { "slot-9": "o", "slot-2": "o" } })],
    });
    const ordered = orderDemandCells(input);
    expect(ordered.map((c) => c.slotIdx)).toEqual([2, 9]);
  });

  it("carries the demand's min/ideal/leadMin/newMax through unchanged", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 2, ideal: 4, leadMin: 1, newMax: 3 }],
      ]),
      applications: [makeApp("a1", { skills: { [ROLE]: { level: "lead", pref: 1 } } })],
    });
    const [cell] = orderDemandCells(input);
    expect(cell).toMatchObject({
      min: 2,
      ideal: 4,
      leadMin: 1,
      newMax: 3,
      trackId: TRACK,
      roleId: ROLE,
    });
  });
});
