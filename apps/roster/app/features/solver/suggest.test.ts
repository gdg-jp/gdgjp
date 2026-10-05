import { describe, expect, it } from "vitest";
import { suggestFor } from "./suggest";
import {
  type Assignments,
  type SolverApplication,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "./types";

const SLOT = { id: "slot-0", idx: 0 };
const TRACK = "track-a";
const ROLE = "reception";

function app(id: string, overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id,
    withdrawn: false,
    skills: { [ROLE]: { level: "exp", pref: 2 } },
    availability: { [SLOT.id]: "o" },
    ...overrides,
  };
}

function input(applications: SolverApplication[]): SolverInput {
  return {
    slots: [SLOT],
    tracks: [{ id: TRACK }],
    roles: [{ id: ROLE }],
    demands: new Map([
      [demandKey(SLOT.id, TRACK, ROLE), { min: 1, ideal: 2, leadMin: 0, newMax: 5 }],
    ]),
    applications,
    options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
  };
}

describe("suggestFor", () => {
  it("orders free-o before free-d before busy before unavailable", () => {
    const apps = [
      app("unavail", { availability: { [SLOT.id]: "x" } }),
      app("busy"),
      app("free-d", { availability: { [SLOT.id]: "d" } }),
      app("free-o"),
    ];
    const assignments: Assignments = new Map([
      [
        assignmentKey("busy", SLOT.id),
        { trackId: "other-track", roleId: "other-role", locked: false },
      ],
    ]);
    const suggestions = suggestFor(input(apps), assignments, SLOT.id, TRACK, ROLE);
    expect(suggestions.map((s) => s.applicationId)).toEqual([
      "free-o",
      "free-d",
      "busy",
      "unavail",
    ]);
    expect(suggestions.map((s) => s.category)).toEqual(["free-o", "free-d", "busy", "unavailable"]);
  });

  it("breaks ties within a category by pref ascending", () => {
    const apps = [
      app("pref2", { skills: { [ROLE]: { level: "exp", pref: 2 } } }),
      app("pref1", { skills: { [ROLE]: { level: "exp", pref: 1 } } }),
      app("noSkill", { skills: {} }),
    ];
    const suggestions = suggestFor(input(apps), new Map(), SLOT.id, TRACK, ROLE);
    expect(suggestions.map((s) => s.applicationId)).toEqual(["pref1", "pref2", "noSkill"]);
    expect(suggestions.map((s) => s.pref)).toEqual([1, 2, 3]);
  });

  it("does not exclude unavailable ('x') candidates — returns them with a warning", () => {
    const apps = [app("blocked", { availability: { [SLOT.id]: "x" } })];
    const suggestions = suggestFor(input(apps), new Map(), SLOT.id, TRACK, ROLE);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].category).toBe("unavailable");
    expect(suggestions[0].warnings.length).toBeGreaterThan(0);
  });

  it("does not exclude withdrawn candidates or candidates without the skill — both come back with warnings", () => {
    const apps = [app("withdrawn", { withdrawn: true }), app("noSkill", { skills: {} })];
    const suggestions = suggestFor(input(apps), new Map(), SLOT.id, TRACK, ROLE);
    expect(suggestions).toHaveLength(2);
    for (const s of suggestions) expect(s.warnings.length).toBeGreaterThan(0);
  });

  it("returns no warnings for a fully valid, unassigned, available candidate", () => {
    const apps = [app("clean")];
    const suggestions = suggestFor(input(apps), new Map(), SLOT.id, TRACK, ROLE);
    expect(suggestions[0].warnings).toEqual([]);
  });

  it("returns every applicant, never filtering the list down", () => {
    const apps = [app("a"), app("b"), app("c")];
    const suggestions = suggestFor(input(apps), new Map(), SLOT.id, TRACK, ROLE);
    expect(suggestions).toHaveLength(3);
  });
});
