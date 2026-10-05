import { describe, expect, it } from "vitest";
import type { Assignments, Demand, Report, SolverInput } from "~/features/solver/types";
import { assignmentKey, demandKey } from "~/features/solver/types";
import {
  buildGridColumns,
  buildRoleGridColumn,
  buildStaffCellCandidates,
  groupAssignmentsByApplication,
  groupAssignmentsByCell,
  indexReportByCell,
  suggestForRange,
} from "./grid";

const SLOTS = [
  { id: "s0", idx: 0 },
  { id: "s1", idx: 1 },
  { id: "s2", idx: 2 },
  { id: "s3", idx: 3 },
];

const DEMAND: Demand = { min: 1, ideal: 2, leadMin: 0, newMax: 99 };

describe("buildGridColumns", () => {
  it("returns one column per distinct (track, role), ordered by track then role sort order", () => {
    const demands = new Map<string, Demand>([
      [demandKey("s0", "trk_b", "roleY"), DEMAND],
      [demandKey("s1", "trk_a", "roleX"), DEMAND],
      [demandKey("s2", "trk_a", "roleY"), DEMAND],
    ]);
    const columns = buildGridColumns(
      demands,
      [
        { id: "trk_a", sortOrder: 0 },
        { id: "trk_b", sortOrder: 1 },
      ],
      [
        { id: "roleX", sortOrder: 0 },
        { id: "roleY", sortOrder: 1 },
      ],
    );
    expect(columns).toEqual([
      { trackId: "trk_a", roleId: "roleX" },
      { trackId: "trk_a", roleId: "roleY" },
      { trackId: "trk_b", roleId: "roleY" },
    ]);
  });

  it("dedupes the same (track, role) pair appearing across multiple slots", () => {
    const demands = new Map<string, Demand>([
      [demandKey("s0", "trk_a", "roleX"), DEMAND],
      [demandKey("s1", "trk_a", "roleX"), DEMAND],
    ]);
    const columns = buildGridColumns(
      demands,
      [{ id: "trk_a", sortOrder: 0 }],
      [{ id: "roleX", sortOrder: 0 }],
    );
    expect(columns).toEqual([{ trackId: "trk_a", roleId: "roleX" }]);
  });
});

describe("groupAssignmentsByCell", () => {
  it("groups applicationIds by (slot, track, role), sorted for stable comparison", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_z", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_m", "s1"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const byCell = groupAssignmentsByCell(assignments);
    expect(byCell.get(demandKey("s0", "trk_a", "roleX"))).toEqual(["app_a", "app_z"]);
    expect(byCell.get(demandKey("s1", "trk_a", "roleX"))).toEqual(["app_m"]);
  });
});

describe("groupAssignmentsByApplication", () => {
  it("groups each application's assignments by slot", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_1", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_1", "s1"), { trackId: "trk_b", roleId: "roleY", locked: false }],
    ]);
    const byApp = groupAssignmentsByApplication(assignments);
    expect(byApp.get("app_1")).toEqual(
      new Map([
        ["s0", { trackId: "trk_a", roleId: "roleX" }],
        ["s1", { trackId: "trk_b", roleId: "roleY" }],
      ]),
    );
  });
});

describe("buildRoleGridColumn", () => {
  /**
   * docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト":
   * "役割別ビューで顔ぶれか需要が変われば縦結合が切れる" — the actual case this
   * pins is a lineup change with the SAME headcount (2 people both slots),
   * which a naive "did the count change" check would wrongly merge.
   */
  it("breaks the merge when the member lineup changes, even if headcount stays the same", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_b", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_a", "s1"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_c", "s1"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const demands = new Map<string, Demand>([
      [demandKey("s0", "trk_a", "roleX"), DEMAND],
      [demandKey("s1", "trk_a", "roleX"), DEMAND],
    ]);
    const cells = buildRoleGridColumn(SLOTS.slice(0, 2), "trk_a", "roleX", assignments, demands);
    expect(cells).toEqual([
      { kind: "start", span: 1, memberIds: ["app_a", "app_b"], demand: DEMAND },
      { kind: "start", span: 1, memberIds: ["app_a", "app_c"], demand: DEMAND },
    ]);
  });

  it("breaks the merge when the demand values change, even if the lineup stays the same", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_a", "s1"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const demands = new Map<string, Demand>([
      [demandKey("s0", "trk_a", "roleX"), DEMAND],
      [demandKey("s1", "trk_a", "roleX"), { ...DEMAND, ideal: 3 }],
    ]);
    const cells = buildRoleGridColumn(SLOTS.slice(0, 2), "trk_a", "roleX", assignments, demands);
    expect(cells).toEqual([
      { kind: "start", span: 1, memberIds: ["app_a"], demand: DEMAND },
      { kind: "start", span: 1, memberIds: ["app_a"], demand: { ...DEMAND, ideal: 3 } },
    ]);
  });

  it("merges a run of identical (lineup, demand) slots into one spanning cell", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_a", "s1"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_a", "s2"), { trackId: "trk_a", roleId: "roleX", locked: false }],
      [assignmentKey("app_z", "s3"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const demands = new Map<string, Demand>([
      [demandKey("s0", "trk_a", "roleX"), DEMAND],
      [demandKey("s1", "trk_a", "roleX"), DEMAND],
      [demandKey("s2", "trk_a", "roleX"), DEMAND],
      [demandKey("s3", "trk_a", "roleX"), DEMAND],
    ]);
    const cells = buildRoleGridColumn(SLOTS, "trk_a", "roleX", assignments, demands);
    expect(cells).toEqual([
      { kind: "start", span: 3, memberIds: ["app_a"], demand: DEMAND },
      { kind: "continued" },
      { kind: "continued" },
      { kind: "start", span: 1, memberIds: ["app_z"], demand: DEMAND },
    ]);
  });

  it("treats consecutive empty (no demand, no members) slots as mergeable too", () => {
    const cells = buildRoleGridColumn(SLOTS, "trk_a", "roleX", new Map(), new Map());
    expect(cells).toEqual([
      { kind: "start", span: 4, memberIds: [], demand: null },
      { kind: "continued" },
      { kind: "continued" },
      { kind: "continued" },
    ]);
  });
});

describe("indexReportByCell", () => {
  it("reshapes evaluate()'s shortages/violations arrays into a per-cell lookup, without re-judging them", () => {
    const report: Report = {
      shortages: [
        { kind: "headcount", slotId: "s0", trackId: "trk_a", roleId: "roleX", amount: 2 },
        { kind: "lead", slotId: "s0", trackId: "trk_a", roleId: "roleX", amount: 1 },
      ],
      violations: [
        { kind: "soloNewcomer", slotId: "s1", trackId: "trk_a", roleId: "roleX", amount: 1 },
      ],
      metrics: {
        demandMin: 0,
        demandIdeal: 0,
        filled: 0,
        idealRate: 1,
        minShortage: 2,
        leadShortage: 1,
        assigned: 0,
        firstChoiceRate: 0,
        loadStdev: 0,
        loadMax: 0,
        loadMin: 0,
        softUsed: 0,
        overwork: 0,
        violationCount: 1,
      },
    };
    const byCell = indexReportByCell(report);
    expect(byCell.get(demandKey("s0", "trk_a", "roleX"))).toEqual({
      headcountShort: 2,
      leadShort: 1,
      violations: [],
    });
    expect(byCell.get(demandKey("s1", "trk_a", "roleX"))).toEqual({
      headcountShort: 0,
      leadShort: 0,
      violations: ["soloNewcomer"],
    });
  });
});

const BASE_INPUT: SolverInput = {
  slots: SLOTS,
  tracks: [{ id: "trk_a" }],
  roles: [{ id: "roleX" }],
  demands: new Map([
    [demandKey("s0", "trk_a", "roleX"), DEMAND],
    [demandKey("s1", "trk_a", "roleX"), DEMAND],
  ]),
  applications: [
    {
      id: "app_a",
      withdrawn: false,
      skills: { roleX: { level: "lead", pref: 1 } },
      availability: { s0: "o", s1: "x" },
    },
    {
      id: "app_b",
      withdrawn: false,
      skills: { roleX: { level: "new", pref: 2 } },
      availability: { s0: "o", s1: "o" },
    },
  ],
  options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
};

describe("buildStaffCellCandidates", () => {
  it("lists every (track, role) with demand at the slot, with current fill counts", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const candidates = buildStaffCellCandidates(BASE_INPUT, assignments, "app_b", "s0");
    expect(candidates).toEqual([
      {
        trackId: "trk_a",
        roleId: "roleX",
        demand: DEMAND,
        current: 1,
        leadCurrent: 1,
        newCurrent: 0,
        warnings: [],
      },
    ]);
  });

  it("does not warn 'already assigned' about the applicant's own current cell in this slot", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    // app_a is asking to move within the same slot — hardViolations must be
    // checked against a copy with their own entry removed first, or every
    // candidate (including their current one) would wrongly warn.
    const candidates = buildStaffCellCandidates(BASE_INPUT, assignments, "app_a", "s0");
    expect(candidates[0].warnings).toEqual([]);
  });

  it("falls back to a synthetic withdrawn applicant instead of throwing when the id is unknown", () => {
    const candidates = buildStaffCellCandidates(BASE_INPUT, new Map(), "app_ghost", "s0");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].warnings.length).toBeGreaterThan(0);
  });

  it("returns [] for a slot the SolverInput doesn't know about", () => {
    expect(buildStaffCellCandidates(BASE_INPUT, new Map(), "app_a", "no-such-slot")).toEqual([]);
  });
});

describe("suggestForRange", () => {
  it("excludes candidates who already occupy this exact cell", () => {
    const assignments: Assignments = new Map([
      [assignmentKey("app_a", "s0"), { trackId: "trk_a", roleId: "roleX", locked: false }],
    ]);
    const suggestions = suggestForRange(BASE_INPUT, assignments, ["s0"], "trk_a", "roleX");
    expect(suggestions.map((s) => s.applicationId)).not.toContain("app_a");
    expect(suggestions.map((s) => s.applicationId)).toContain("app_b");
  });

  it("unions warnings across every slot in the range, not just the first", () => {
    // app_a is "o" at s0 but "x" at s1 — a single-slot suggestFor("s0")
    // would miss the s1 problem entirely.
    const suggestions = suggestForRange(BASE_INPUT, new Map(), ["s0", "s1"], "trk_a", "roleX");
    const appA = suggestions.find((s) => s.applicationId === "app_a");
    expect(appA?.warnings.some((w) => w.includes("稼働不可"))).toBe(true);
  });
});
