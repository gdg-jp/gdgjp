import { describe, expect, it } from "vitest";
import { buildFixture, buildSmallFixture } from "./fixtures";
import { solve } from "./solve";
import { type AssignmentValue, type SolverInput, getAvailability } from "./types";

function assertNoHardViolations(
  input: SolverInput,
  assignments: Map<string, AssignmentValue>,
): void {
  const appsById = new Map(input.applications.map((a) => [a.id, a]));
  for (const [key, value] of assignments) {
    const sep = key.indexOf("|");
    const appId = key.slice(0, sep);
    const slotId = key.slice(sep + 1);
    const app = appsById.get(appId);

    expect(app, `assignment references unknown app ${appId}`).toBeDefined();
    if (!app) continue;
    expect(app.withdrawn, `${appId} is withdrawn but was assigned at ${slotId}`).toBe(false);
    expect(
      getAvailability(app, slotId),
      `${appId} assigned to an unavailable ('x') slot ${slotId}`,
    ).not.toBe("x");
    expect(
      app.skills[value.roleId],
      `${appId} assigned to role ${value.roleId} with no skill record`,
    ).toBeDefined();

    const demand = input.demands.get(`${slotId}|${value.trackId}|${value.roleId}`);
    expect(Boolean(demand && demand.ideal > 0), "assignment placed in a cell with no demand").toBe(
      true,
    );
  }
}

describe("solve", () => {
  // This is the single most important regression in this feature (see
  // docs/roster/06-solver.md's "回帰として固定すべきテスト"): if this is ever
  // flaky, Stage 07's re-generate button and Stage 08's history comparison
  // both silently stop meaning anything.
  it("is deterministic: the same input and seed produce a deeply-equal Assignments map every time", () => {
    const input = buildSmallFixture(42);
    const first = solve(input);
    const second = solve(input);
    expect(second.assignments).toEqual(first.assignments);
    expect(second.report).toEqual(first.report);
  });

  it("produces a different result for a different seed (proves the rng is actually exercised)", () => {
    const input = buildSmallFixture(42);
    const withSeed1 = solve(input, { seed: 1 });
    const withSeed2 = solve(input, { seed: 2 });
    expect(withSeed2.assignments).not.toEqual(withSeed1.assignments);
  });

  it("opts.seed overrides input.options.seed", () => {
    const input = buildSmallFixture(1);
    const viaOptions = solve(input, { seed: 999 });
    const viaInput = solve({ ...input, options: { ...input.options, seed: 999 } });
    expect(viaOptions.assignments).toEqual(viaInput.assignments);
  });

  it("never produces a hard-constraint violation on the index.md-scale illustrative fixture", () => {
    const input = buildSmallFixture(7);
    const { assignments } = solve(input);
    assertNoHardViolations(input, assignments);
  });

  it("never produces a hard-constraint violation on a larger randomized fixture", () => {
    const input = buildFixture({
      staffCount: 40,
      slotCount: 20,
      roleCount: 8,
      trackCount: 3,
      seed: 99,
    });
    const { assignments } = solve(input);
    assertNoHardViolations(input, assignments);
  });

  it("reports lead shortages when no lead-level staff exist anywhere in the input", () => {
    const input = buildFixture({
      staffCount: 20,
      slotCount: 6,
      roleCount: 4,
      trackCount: 2,
      seed: 5,
    });
    for (const app of input.applications) {
      for (const roleId of Object.keys(app.skills)) {
        if (app.skills[roleId].level === "lead") {
          app.skills[roleId] = { ...app.skills[roleId], level: "exp" };
        }
      }
    }
    const [firstKey, firstDemand] = [...input.demands.entries()][0];
    input.demands.set(firstKey, { ...firstDemand, leadMin: Math.max(firstDemand.leadMin, 1) });

    const { report } = solve(input);
    expect(report.shortages.some((s) => s.kind === "lead")).toBe(true);
  });

  it("reports headcount shortages when demand vastly exceeds supply", () => {
    const input = buildFixture({
      staffCount: 4,
      slotCount: 4,
      roleCount: 2,
      trackCount: 1,
      seed: 3,
    });
    for (const [key, demand] of input.demands) {
      input.demands.set(key, { ...demand, min: 50, ideal: 50 });
    }
    const { report } = solve(input);
    expect(report.metrics.minShortage).toBeGreaterThan(0);
    expect(report.shortages.some((s) => s.kind === "headcount")).toBe(true);
  });

  it("keeps headcount and lead shortages distinct when both occur in the same input", () => {
    const input = buildFixture({
      staffCount: 4,
      slotCount: 4,
      roleCount: 2,
      trackCount: 1,
      seed: 3,
    });
    for (const app of input.applications) {
      for (const roleId of Object.keys(app.skills)) {
        if (app.skills[roleId].level === "lead") {
          app.skills[roleId] = { ...app.skills[roleId], level: "exp" };
        }
      }
    }
    for (const [key, demand] of input.demands) {
      input.demands.set(key, {
        ...demand,
        min: 50,
        ideal: 50,
        leadMin: Math.max(demand.leadMin, 1),
      });
    }
    const { report } = solve(input);
    const kinds = new Set(report.shortages.map((s) => s.kind));
    expect(kinds.has("headcount")).toBe(true);
    expect(kinds.has("lead")).toBe(true);
  });

  describe("keepLocked", () => {
    it("keeps a locked existing assignment fixed and does not disturb its value", () => {
      const input = buildSmallFixture(11);
      const first = solve(input);
      const [[key, value]] = [...first.assignments.entries()];
      const existingAssignments = new Map([[key, { ...value, locked: true }]]);

      const second = solve({ ...input, existingAssignments }, { keepLocked: true });
      expect(second.assignments.get(key)).toEqual({ ...value, locked: true });
    });

    it("ignores existingAssignments entirely when keepLocked is not passed", () => {
      const input = buildSmallFixture(11);
      const first = solve(input);
      const [[key, value]] = [...first.assignments.entries()];
      const existingAssignments = new Map([[key, { ...value, locked: true }]]);

      const second = solve({ ...input, existingAssignments }); // no opts.keepLocked
      expect(second.assignments).toEqual(first.assignments);
    });
  });

  // Regression for a bug found via manual QA (not by any existing fixture):
  // `newcomerAllowed` compared the cell's TOTAL headcount against `newMax`
  // instead of the count of "new"-level members. Any cell with `leadMin >= 1`
  // hit `newMax` the instant its required lead was placed — with zero actual
  // newcomers seated — permanently blocking the newcomer half of its own
  // demand. This is index.md §5.2's own illustrative example ("受付は常時1名
  // 以上のリード経験者" + "初参加者は1名まで"), so it is not an edge case.
  it("fills a cell's newcomer seat even when leadMin already put an experienced member in it", () => {
    const input: SolverInput = {
      slots: [{ id: "slot-0", idx: 0 }],
      tracks: [{ id: "track-0" }],
      roles: [{ id: "role-0" }],
      demands: new Map([["slot-0|track-0|role-0", { min: 2, ideal: 2, leadMin: 1, newMax: 1 }]]),
      applications: [
        {
          id: "lead-1",
          withdrawn: false,
          skills: { "role-0": { level: "lead", pref: 2 } },
          availability: { "slot-0": "o" },
        },
        {
          id: "new-1",
          withdrawn: false,
          skills: { "role-0": { level: "new", pref: 2 } },
          availability: { "slot-0": "o" },
        },
      ],
      options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
    };

    const { assignments, report } = solve(input);

    expect(assignments.size).toBe(2);
    expect(assignments.has("lead-1|slot-0")).toBe(true);
    expect(assignments.has("new-1|slot-0")).toBe(true);
    expect(report.metrics.minShortage).toBe(0);
  });
});
