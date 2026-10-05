import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluate";
import {
  type Assignments,
  type SolverApplication,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "./types";

const TRACK = "track-a";
const ROLE = "reception";

function slotsN(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `slot-${i}`, idx: i }));
}

function app(id: string, overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id,
    withdrawn: false,
    skills: { [ROLE]: { level: "exp", pref: 2 } },
    availability: {},
    ...overrides,
  };
}

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    slots: slotsN(4),
    tracks: [{ id: TRACK }],
    roles: [{ id: ROLE }],
    demands: new Map(),
    applications: [],
    options: { noSoloNewcomer: true, maxConsecutive: 2, seed: 1 },
    ...overrides,
  };
}

describe("evaluate", () => {
  it("reports headcount shortage separately from lead shortage in the same cell", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 3, ideal: 3, leadMin: 1, newMax: 5 }],
      ]),
      applications: [app("a1", { skills: { [ROLE]: { level: "exp", pref: 2 } } })],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);

    const headcount = report.shortages.filter((s) => s.kind === "headcount");
    const lead = report.shortages.filter((s) => s.kind === "lead");
    expect(headcount).toEqual([
      { kind: "headcount", slotId: "slot-0", trackId: TRACK, roleId: ROLE, amount: 2 },
    ]);
    expect(lead).toEqual([
      { kind: "lead", slotId: "slot-0", trackId: TRACK, roleId: ROLE, amount: 1 },
    ]);
    expect(report.metrics.minShortage).toBe(2);
    expect(report.metrics.leadShortage).toBe(1);
  });

  it("flags soloNewcomer only when noSoloNewcomer is enabled", () => {
    const demands = new Map([
      [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
    ]);
    const applications = [app("a1", { skills: { [ROLE]: { level: "new", pref: 2 } } })];
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);

    const enabled = evaluate(
      baseInput({
        demands,
        applications,
        options: { noSoloNewcomer: true, maxConsecutive: 2, seed: 1 },
      }),
      assignments,
    );
    expect(enabled.violations.some((v) => v.kind === "soloNewcomer")).toBe(true);

    const disabled = evaluate(
      baseInput({
        demands,
        applications,
        options: { noSoloNewcomer: false, maxConsecutive: 2, seed: 1 },
      }),
      assignments,
    );
    expect(disabled.violations.some((v) => v.kind === "soloNewcomer")).toBe(false);
  });

  it("flags newcomerOver when the newcomer count exceeds newMax", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 2, leadMin: 0, newMax: 1 }],
      ]),
      applications: [
        app("a1", { skills: { [ROLE]: { level: "new", pref: 2 } } }),
        app("a2", { skills: { [ROLE]: { level: "new", pref: 2 } } }),
      ],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a2", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.violations).toContainEqual({
      kind: "newcomerOver",
      slotId: "slot-0",
      trackId: TRACK,
      roleId: ROLE,
      amount: 1,
    });
  });

  it("flags over when members exceed ideal (a manual-edit-only situation)", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [app("a1"), app("a2")],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a2", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.violations).toContainEqual({
      kind: "over",
      slotId: "slot-0",
      trackId: TRACK,
      roleId: ROLE,
      amount: 1,
    });
    // "over" is a violation, never counted as a shortage.
    expect(report.shortages).toEqual([]);
  });

  it("ignores demand cells with ideal === 0 entirely", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 0, ideal: 0, leadMin: 0, newMax: 0 }],
      ]),
      applications: [],
    });
    const report = evaluate(input, new Map());
    expect(report.shortages).toEqual([]);
    expect(report.violations).toEqual([]);
    expect(report.metrics.demandMin).toBe(0);
    expect(report.metrics.demandIdeal).toBe(0);
  });

  it("computes filled / idealRate as min(members, ideal) summed over cells", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 2, leadMin: 0, newMax: 5 }],
        [demandKey("slot-1", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [app("a1"), app("a2"), app("a3")],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a2", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a3", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }], // over ideal(2) -> capped at 2
      [assignmentKey("a1", "slot-1"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    // slot-0: min(3, 2) = 2; slot-1: min(1, 1) = 1 -> filled = 3, demandIdeal = 3
    expect(report.metrics.filled).toBe(3);
    expect(report.metrics.demandIdeal).toBe(3);
    expect(report.metrics.idealRate).toBeCloseTo(1, 10);
  });

  it("computes firstChoiceRate as the share of assignments at pref 1", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 2, ideal: 2, leadMin: 0, newMax: 5 }],
      ]),
      applications: [
        app("a1", { skills: { [ROLE]: { level: "exp", pref: 1 } } }),
        app("a2", { skills: { [ROLE]: { level: "exp", pref: 2 } } }),
      ],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a2", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.metrics.firstChoiceRate).toBeCloseTo(0.5, 10);
  });

  it("computes load stdev/max/min over non-withdrawn applicants only", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
        [demandKey("slot-1", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [app("busy"), app("idle"), app("gone", { withdrawn: true })],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("busy", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("busy", "slot-1"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.metrics.loadMax).toBe(2);
    expect(report.metrics.loadMin).toBe(0); // "idle" (not withdrawn) pulls the min down
    expect(report.metrics.loadStdev).toBeGreaterThan(0);
  });

  it("counts softUsed as the number of assignments using 'd' availability", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 0, newMax: 5 }],
      ]),
      applications: [app("a1", { availability: { "slot-0": "d" } })],
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.metrics.softUsed).toBe(1);
  });

  it("counts overwork as staff whose longest contiguous streak exceeds maxConsecutive", () => {
    const input = baseInput({
      demands: new Map(
        slotsN(4).map((s) => [
          demandKey(s.id, TRACK, ROLE),
          { min: 1, ideal: 1, leadMin: 0, newMax: 5 },
        ]),
      ),
      applications: [app("a1")],
      options: { noSoloNewcomer: true, maxConsecutive: 2, seed: 1 },
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a1", "slot-1"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a1", "slot-2"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    // streak of 3 > maxConsecutive(2) -> overwork counts this 1 staff member.
    expect(report.metrics.overwork).toBe(1);
  });

  it("does not count overwork for a streak broken by a gap", () => {
    const input = baseInput({
      demands: new Map(
        slotsN(4).map((s) => [
          demandKey(s.id, TRACK, ROLE),
          { min: 1, ideal: 1, leadMin: 0, newMax: 5 },
        ]),
      ),
      applications: [app("a1")],
      options: { noSoloNewcomer: true, maxConsecutive: 2, seed: 1 },
    });
    const assignments: Assignments = new Map([
      [assignmentKey("a1", "slot-0"), { trackId: TRACK, roleId: ROLE, locked: false }],
      [assignmentKey("a1", "slot-1"), { trackId: TRACK, roleId: ROLE, locked: false }],
      // gap at slot-2
      [assignmentKey("a1", "slot-3"), { trackId: TRACK, roleId: ROLE, locked: false }],
    ]);
    const report = evaluate(input, assignments);
    expect(report.metrics.overwork).toBe(0);
  });

  it("sums demandMin and demandIdeal across every active cell", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 2, leadMin: 0, newMax: 5 }],
        [demandKey("slot-1", TRACK, ROLE), { min: 2, ideal: 3, leadMin: 0, newMax: 5 }],
      ]),
      applications: [],
    });
    const report = evaluate(input, new Map());
    expect(report.metrics.demandMin).toBe(3);
    expect(report.metrics.demandIdeal).toBe(5);
  });

  it("does not crash on an empty assignments map and reports 100% shortage", () => {
    const input = baseInput({
      demands: new Map([
        [demandKey("slot-0", TRACK, ROLE), { min: 1, ideal: 1, leadMin: 1, newMax: 5 }],
      ]),
      applications: [],
    });
    const report = evaluate(input, new Map());
    expect(report.metrics.minShortage).toBe(1);
    expect(report.metrics.leadShortage).toBe(1);
    expect(report.metrics.assigned).toBe(0);
    expect(report.metrics.firstChoiceRate).toBe(0);
  });
});
