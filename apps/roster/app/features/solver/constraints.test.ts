import { describe, expect, it } from "vitest";
import { hardViolations } from "./constraints";
import {
  type Assignments,
  type SolverApplication,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "./types";

const SLOT = { id: "slot-0", idx: 0 };
const TRACK_ID = "track-a";
const ROLE_ID = "reception";

function baseInput(): SolverInput {
  return {
    slots: [SLOT],
    tracks: [{ id: TRACK_ID }],
    roles: [{ id: ROLE_ID }],
    demands: new Map([
      [demandKey(SLOT.id, TRACK_ID, ROLE_ID), { min: 1, ideal: 2, leadMin: 0, newMax: 1 }],
    ]),
    applications: [],
    options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
  };
}

function baseApp(overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id: "app-1",
    withdrawn: false,
    skills: { [ROLE_ID]: { level: "exp", pref: 1 } },
    availability: { [SLOT.id]: "o" },
    ...overrides,
  };
}

describe("hardViolations", () => {
  it("returns no warnings for a fully valid placement", () => {
    const input = baseInput();
    const app = baseApp();
    const assignments: Assignments = new Map();
    expect(hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, assignments)).toEqual([]);
  });

  it("flags a staff member already assigned to this slot (rule 1: no double-booking a slot)", () => {
    const input = baseInput();
    const app = baseApp();
    const assignments: Assignments = new Map([
      [
        assignmentKey(app.id, SLOT.id),
        { trackId: "other-track", roleId: "other-role", locked: false },
      ],
    ]);
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, assignments);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("1人2箇所"))).toBe(true);
  });

  it("names the constraint, never the applicant — the id must not leak into the UI", () => {
    // Regression: these strings used to interpolate `app.id`, which has no
    // display meaning and reached the manual-edit drawers verbatim
    // ("app-2 はこの役割を担当できません"). Both callers already show the
    // person's name next to the warning; see constraints.ts's doc comment.
    const input = baseInput();
    const app = baseApp({ withdrawn: true, skills: {}, availability: { [SLOT.id]: "x" } });
    const assignments: Assignments = new Map([
      [assignmentKey(app.id, SLOT.id), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
    ]);
    const warnings = hardViolations(input, app, SLOT, "no-such-track", ROLE_ID, assignments);
    expect(warnings.length).toBe(5);
    expect(warnings.every((w) => !w.includes(app.id))).toBe(true);
  });

  it("flags a role the applicant has no skill record for (rule 2)", () => {
    const input = baseInput();
    const app = baseApp({ skills: {} });
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("flags an unavailable ('x') slot (rule 3)", () => {
    const input = baseInput();
    const app = baseApp({ availability: { [SLOT.id]: "x" } });
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("treats a missing availability entry as unavailable ('x')", () => {
    const input = baseInput();
    const app = baseApp({ availability: {} });
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("flags a withdrawn applicant (rule 4)", () => {
    const input = baseInput();
    const app = baseApp({ withdrawn: true });
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("flags a cell with no demand row (rule 5)", () => {
    const input = baseInput();
    const app = baseApp();
    const warnings = hardViolations(input, app, SLOT, "no-such-track", ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("flags a cell whose demand row has ideal === 0 (same as no row, per index.md §4)", () => {
    const input = baseInput();
    input.demands.set(demandKey(SLOT.id, TRACK_ID, ROLE_ID), {
      min: 0,
      ideal: 0,
      leadMin: 0,
      newMax: 0,
    });
    const app = baseApp();
    const warnings = hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map());
    expect(warnings.length).toBe(1);
  });

  it("accumulates every violated rule, not just the first", () => {
    const input = baseInput();
    const app = baseApp({ withdrawn: true, skills: {}, availability: { [SLOT.id]: "x" } });
    const assignments: Assignments = new Map([
      [assignmentKey(app.id, SLOT.id), { trackId: TRACK_ID, roleId: ROLE_ID, locked: false }],
    ]);
    const warnings = hardViolations(input, app, SLOT, "no-such-track", ROLE_ID, assignments);
    // rule 1 (already assigned) + rule 2 (no skill) + rule 3 (x) + rule 4 (withdrawn) + rule 5 (no demand)
    expect(warnings.length).toBe(5);
  });

  it("never throws — always returns an array, even for a maximally-invalid placement", () => {
    const input = baseInput();
    const app = baseApp({ withdrawn: true, skills: {}, availability: {} });
    expect(() =>
      hardViolations(input, app, SLOT, "ghost-track", "ghost-role", new Map()),
    ).not.toThrow();
  });

  it("does NOT check skill-mix conditions (leadMin / newMax) — that is the caller's job", () => {
    // A "new" candidate placed into a cell whose newMax is already 0 would
    // violate the skill-mix rule, but hardViolations only knows the 5 rules
    // in index.md §5.1 items 1-4/6 — leadMin/newMax is deliberately left to
    // solve.ts's fillCell / local-search.ts / ojt-swap.ts (Design §2).
    const input = baseInput();
    input.demands.set(demandKey(SLOT.id, TRACK_ID, ROLE_ID), {
      min: 1,
      ideal: 1,
      leadMin: 0,
      newMax: 0,
    });
    const app = baseApp({ skills: { [ROLE_ID]: { level: "new", pref: 2 } } });
    expect(hardViolations(input, app, SLOT, TRACK_ID, ROLE_ID, new Map())).toEqual([]);
  });
});
