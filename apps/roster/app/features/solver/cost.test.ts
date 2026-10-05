import { describe, expect, it } from "vitest";
import { type CostContext, candidateCost } from "./cost";
import { type Assignments, type SolverApplication, assignmentKey } from "./types";

const ROLE_ID = "reception";
const TRACK_ID = "track-a";

function zeroRng(): number {
  return 0;
}

function ctx(overrides: Partial<CostContext> = {}): CostContext {
  return {
    assignments: new Map(),
    load: new Map(),
    slotIdByIdx: new Map([
      [0, "slot-0"],
      [1, "slot-1"],
      [2, "slot-2"],
      [3, "slot-3"],
      [4, "slot-4"],
    ]),
    rng: zeroRng,
    maxConsecutive: 4,
    ...overrides,
  };
}

function app(overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id: "app-1",
    withdrawn: false,
    skills: { [ROLE_ID]: { level: "exp", pref: 2 } },
    availability: { "slot-0": "o", "slot-1": "o", "slot-2": "o", "slot-3": "o", "slot-4": "o" },
    ...overrides,
  };
}

const SLOT0 = { id: "slot-0", idx: 0 };

describe("candidateCost", () => {
  it("is 0 for a baseline candidate: available (o), pref 2, no load, no history", () => {
    expect(candidateCost(ctx(), app(), SLOT0, TRACK_ID, ROLE_ID)).toBe(0);
  });

  it("costs +Infinity for an unavailable ('x') slot — must dominate every other term", () => {
    const a = app({
      availability: { "slot-0": "x" },
      skills: { [ROLE_ID]: { level: "exp", pref: 1 } },
    });
    expect(candidateCost(ctx(), a, SLOT0, TRACK_ID, ROLE_ID)).toBe(Number.POSITIVE_INFINITY);
  });

  it("costs +4.5 for a soft-available ('d') slot", () => {
    const a = app({ availability: { "slot-0": "d" } });
    expect(candidateCost(ctx(), a, SLOT0, TRACK_ID, ROLE_ID)).toBeCloseTo(4.5, 10);
  });

  it("rewards first choice (pref 1) with -6", () => {
    const a = app({ skills: { [ROLE_ID]: { level: "exp", pref: 1 } } });
    expect(candidateCost(ctx(), a, SLOT0, TRACK_ID, ROLE_ID)).toBeCloseTo(-6, 10);
  });

  it("costs +3 when the candidate has no skill record for this role", () => {
    const a = app({ skills: {} });
    expect(candidateCost(ctx(), a, SLOT0, TRACK_ID, ROLE_ID)).toBeCloseTo(3, 10);
  });

  it("costs +1.6 per existing assignment (load fairness)", () => {
    const c = ctx({ load: new Map([["app-1", 3]]) });
    expect(candidateCost(c, app(), SLOT0, TRACK_ID, ROLE_ID)).toBeCloseTo(1.6 * 3, 10);
  });

  it("rewards -3.5 for continuing the same track and role as the previous slot", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app-1", "slot-0"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
    ]);
    const c = ctx({ assignments });
    const slot1 = { id: "slot-1", idx: 1 };
    expect(candidateCost(c, app(), slot1, TRACK_ID, ROLE_ID)).toBeCloseTo(-3.5, 10);
  });

  it("costs +1.2 for switching to a different track than the previous slot", () => {
    const assignments: Assignments = new Map([
      [
        assignmentKey("app-1", "slot-0"),
        { trackId: "other-track", roleId: ROLE_ID, locked: false },
      ],
    ]);
    const c = ctx({ assignments });
    const slot1 = { id: "slot-1", idx: 1 };
    expect(candidateCost(c, app(), slot1, TRACK_ID, ROLE_ID)).toBeCloseTo(1.2, 10);
  });

  it("is neutral (0) when the track stays the same but the role changes", () => {
    const assignments: Assignments = new Map([
      [
        assignmentKey("app-1", "slot-0"),
        { trackId: TRACK_ID, roleId: "other-role", locked: false },
      ],
    ]);
    const c = ctx({ assignments });
    const slot1 = { id: "slot-1", idx: 1 };
    expect(candidateCost(c, app(), slot1, TRACK_ID, ROLE_ID)).toBeCloseTo(0, 10);
  });

  it("ignores continuity entirely at idx 0 (no previous slot to compare against)", () => {
    // Even if somehow an assignment existed keyed at a "before slot 0" slot,
    // idx 0 must never look backward.
    expect(candidateCost(ctx(), app(), SLOT0, TRACK_ID, ROLE_ID)).toBe(0);
  });

  it("costs +4 when this placement would create a streak of maxConsecutive - 1", () => {
    // maxConsecutive = 4: slots 0,1 already held -> placing at slot 2 makes a streak of 3.
    const assignments: Assignments = new Map([
      [assignmentKey("app-1", "slot-0"), { trackId: "x", roleId: "y", locked: false }],
      [assignmentKey("app-1", "slot-1"), { trackId: "x", roleId: "y", locked: false }],
    ]);
    const c = ctx({ assignments });
    const slot2 = { id: "slot-2", idx: 2 };
    // continuity vs "x"/"y" track differs from TRACK_ID -> +1.2, plus streak-of-3 -> +4
    expect(candidateCost(c, app(), slot2, TRACK_ID, ROLE_ID)).toBeCloseTo(1.2 + 4, 10);
  });

  it("costs +12 when this placement would create a streak of exactly maxConsecutive", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app-1", "slot-0"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
      [assignmentKey("app-1", "slot-1"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
      [assignmentKey("app-1", "slot-2"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
    ]);
    const c = ctx({ assignments });
    const slot3 = { id: "slot-3", idx: 3 };
    // continuity same track/role -> -3.5, plus streak-of-4 (== maxConsecutive) -> +12
    expect(candidateCost(c, app(), slot3, TRACK_ID, ROLE_ID)).toBeCloseTo(-3.5 + 12, 10);
  });

  it("a gap in the streak resets the count — a non-contiguous prior slot doesn't count", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app-1", "slot-0"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
      // slot-1 deliberately has no assignment for app-1 — the streak breaks here.
      [assignmentKey("app-1", "slot-2"), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
    ]);
    const c = ctx({ assignments });
    const slot3 = { id: "slot-3", idx: 3 };
    // streak ending at slot3 = slot2 + slot3(hypothetical) = 2, not 4.
    // continuity same track/role as slot2 -> -3.5, no streak penalty.
    expect(candidateCost(c, app(), slot3, TRACK_ID, ROLE_ID)).toBeCloseTo(-3.5, 10);
  });

  it("costs +0.8 for being a lead at this role", () => {
    const a = app({ skills: { [ROLE_ID]: { level: "lead", pref: 2 } } });
    expect(candidateCost(ctx(), a, SLOT0, TRACK_ID, ROLE_ID)).toBeCloseTo(0.8, 10);
  });

  it("adds exactly rng() * 0.4 as a tiebreak, consuming the rng exactly once", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const cost = candidateCost(ctx({ rng }), app(), SLOT0, TRACK_ID, ROLE_ID);
    expect(calls).toBe(1);
    expect(cost).toBeCloseTo(0.2, 10);
  });

  it("does not consume the rng at all for an unavailable ('x') candidate", () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const a = app({ availability: { "slot-0": "x" } });
    candidateCost(ctx({ rng }), a, SLOT0, TRACK_ID, ROLE_ID);
    expect(calls).toBe(0);
  });
});
