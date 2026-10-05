import { describe, expect, it } from "vitest";
import { localSearch } from "./local-search";
import { mulberry32 } from "./random";
import type { EngineState, Movers } from "./solve";
import {
  type AssignmentValue,
  type SolverApplication,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "./types";

// local-search.ts operates purely on `EngineState` + `Movers`, both of which
// solve.ts deliberately does not export the constructors for (see solve.ts's
// module doc comment on why mutation is dependency-injected). This tiny
// harness reproduces just enough of solve.ts's bookkeeping to drive
// localSearch directly and inspect the result, without going through the
// full 7-step `solve()` flow.
function buildState(input: SolverInput, seed: number): EngineState {
  return {
    input,
    rng: mulberry32(seed),
    assignments: new Map(),
    load: new Map(),
    cellMembers: new Map(),
    appSlots: new Map(),
    slotIdxById: new Map(input.slots.map((s) => [s.id, s.idx])),
    slotIdByIdx: new Map(input.slots.map((s) => [s.idx, s.id])),
    appsById: new Map(input.applications.map((a) => [a.id, a])),
  };
}

function place(
  state: EngineState,
  appId: string,
  slotIdx: number,
  trackId: string,
  roleId: string,
  locked: boolean,
): void {
  const slotId = state.slotIdByIdx.get(slotIdx);
  if (!slotId) return;
  const value: AssignmentValue = { trackId, roleId, locked };
  state.assignments.set(assignmentKey(appId, slotId), value);
  state.load.set(appId, (state.load.get(appId) ?? 0) + 1);
  const dKey = demandKey(slotId, trackId, roleId);
  const members = state.cellMembers.get(dKey) ?? new Set<string>();
  members.add(appId);
  state.cellMembers.set(dKey, members);
  const bySlot = state.appSlots.get(appId) ?? new Map<number, AssignmentValue>();
  bySlot.set(slotIdx, value);
  state.appSlots.set(appId, bySlot);
}

function unplace(state: EngineState, appId: string, slotIdx: number): void {
  const slotId = state.slotIdByIdx.get(slotIdx);
  if (!slotId) return;
  const existing = state.assignments.get(assignmentKey(appId, slotId));
  if (!existing) return;
  state.assignments.delete(assignmentKey(appId, slotId));
  state.load.set(appId, Math.max(0, (state.load.get(appId) ?? 1) - 1));
  state.cellMembers.get(demandKey(slotId, existing.trackId, existing.roleId))?.delete(appId);
  state.appSlots.get(appId)?.delete(slotIdx);
}

function makeMovers(state: EngineState): Movers {
  return {
    place: (appId, slotIdx, trackId, roleId, locked) =>
      place(state, appId, slotIdx, trackId, roleId, locked),
    unplace: (appId, slotIdx) => unplace(state, appId, slotIdx),
  };
}

function costCtxOf(state: EngineState) {
  return {
    assignments: state.assignments,
    load: state.load,
    slotIdByIdx: state.slotIdByIdx,
    rng: state.rng,
    maxConsecutive: state.input.options.maxConsecutive,
  };
}

function slots(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `slot-${i}`, idx: i }));
}

function app(id: string, overrides: Partial<SolverApplication> = {}): SolverApplication {
  return {
    id,
    withdrawn: false,
    skills: { r: { level: "exp", pref: 2 } },
    availability: {},
    ...overrides,
  };
}

const TRACK = "t";
const ROLE = "r";

function baseInput(
  n: number,
  apps: SolverApplication[],
  demandOverrides?: Partial<{ leadMin: number; newMax: number }>,
): SolverInput {
  const demands = new Map(
    Array.from({ length: n }, (_, i) => [
      demandKey(`slot-${i}`, TRACK, ROLE),
      {
        min: 1,
        ideal: 1,
        leadMin: demandOverrides?.leadMin ?? 0,
        newMax: demandOverrides?.newMax ?? 5,
      },
    ]),
  );
  return {
    slots: slots(n),
    tracks: [{ id: TRACK }],
    roles: [{ id: ROLE }],
    demands,
    applications: apps,
    options: { noSoloNewcomer: true, maxConsecutive: 10, seed: 1 },
  };
}

function availAll(n: number, value: "o" | "d" | "x" = "o"): Record<string, "o" | "d" | "x"> {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`slot-${i}`, value]));
}

describe("localSearch", () => {
  it("moves a shift from the heaviest staff member to the lightest available one", () => {
    const heavy = app("heavy", { availability: availAll(3) });
    const light = app("light", { availability: availAll(3) });
    const input = baseInput(3, [heavy, light]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "heavy", 0, TRACK, ROLE, false);
    place(state, "heavy", 1, TRACK, ROLE, false);
    place(state, "heavy", 2, TRACK, ROLE, false);

    localSearch(state, costCtxOf(state), movers);

    expect(state.load.get("heavy")).toBe(2);
    expect(state.load.get("light")).toBe(1);
    // Total assignments preserved — this was a move, not a net change in headcount.
    expect(state.assignments.size).toBe(3);
  });

  it("never moves a locked assignment, and stops the pass immediately if all are locked", () => {
    const heavy = app("heavy", { availability: availAll(3) });
    const light = app("light", { availability: availAll(3) });
    const input = baseInput(3, [heavy, light]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "heavy", 0, TRACK, ROLE, true);
    place(state, "heavy", 1, TRACK, ROLE, true);
    place(state, "heavy", 2, TRACK, ROLE, true);

    localSearch(state, costCtxOf(state), movers);

    expect(state.load.get("heavy")).toBe(3);
    expect(state.load.get("light") ?? 0).toBe(0);
  });

  it("does not move a shift if it would break the destination cell's leadMin", () => {
    // 3 cells, each leadMin=1, and "lead" is the sole lead in all 3 — moving
    // any one of them to "exp" (not a lead) would break that cell's leadMin.
    const lead = app("lead", {
      availability: availAll(3),
      skills: { [ROLE]: { level: "lead", pref: 2 } },
    });
    const exp = app("exp", {
      availability: availAll(3),
      skills: { [ROLE]: { level: "exp", pref: 2 } },
    });
    const input = baseInput(3, [lead, exp], { leadMin: 1 });
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "lead", 0, TRACK, ROLE, false);
    place(state, "lead", 1, TRACK, ROLE, false);
    place(state, "lead", 2, TRACK, ROLE, false);

    localSearch(state, costCtxOf(state), movers);

    // No valid recipient exists (the only other pool member would break
    // leadMin no matter which of the 3 assignments gets picked) — untouched.
    expect(state.load.get("lead")).toBe(3);
    expect(state.load.get("exp") ?? 0).toBe(0);
  });

  it("does not move a shift if it would exceed the destination cell's newMax", () => {
    // 3 cells, each newMax=0 — moving any of "exp"'s shifts to "newbie"
    // (level "new") would push that cell's newcomer count over newMax.
    const expStaff = app("exp", {
      availability: availAll(3),
      skills: { [ROLE]: { level: "exp", pref: 2 } },
    });
    const newbie = app("newbie", {
      availability: availAll(3),
      skills: { [ROLE]: { level: "new", pref: 2 } },
    });
    const input = baseInput(3, [expStaff, newbie], { newMax: 0 });
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "exp", 0, TRACK, ROLE, false);
    place(state, "exp", 1, TRACK, ROLE, false);
    place(state, "exp", 2, TRACK, ROLE, false);

    localSearch(state, costCtxOf(state), movers);

    expect(state.load.get("exp")).toBe(3);
    expect(state.load.get("newbie") ?? 0).toBe(0);
  });

  it("only moves a shift to a staff member available as 'o', never 'd'", () => {
    const heavy = app("heavy", { availability: availAll(3, "o") });
    const soft = app("soft", { availability: availAll(3, "d") });
    const input = baseInput(3, [heavy, soft]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "heavy", 0, TRACK, ROLE, false);
    place(state, "heavy", 1, TRACK, ROLE, false);
    place(state, "heavy", 2, TRACK, ROLE, false);

    localSearch(state, costCtxOf(state), movers);

    expect(state.load.get("heavy")).toBe(3);
    expect(state.load.get("soft") ?? 0).toBe(0);
  });

  it("does nothing once the load spread is already within the converged threshold", () => {
    const a = app("a", { availability: availAll(2) });
    const b = app("b", { availability: availAll(2) });
    const input = baseInput(2, [a, b]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "a", 0, TRACK, ROLE, false);
    place(state, "b", 1, TRACK, ROLE, false);
    const before = new Map(state.assignments);

    localSearch(state, costCtxOf(state), movers);

    expect(state.assignments).toEqual(before);
  });
});
