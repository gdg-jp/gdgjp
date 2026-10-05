import { describe, expect, it } from "vitest";
import { ojtSwap } from "./ojt-swap";
import { mulberry32 } from "./random";
import type { EngineState, Movers } from "./solve";
import {
  type AssignmentValue,
  type Level,
  type SolverApplication,
  type SolverInput,
  assignmentKey,
  demandKey,
} from "./types";

// Same minimal harness as local-search.test.ts — see its comment for why
// this is reconstructed locally rather than imported from solve.ts.
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

function makeMovers(state: EngineState): Movers {
  return {
    place: (appId, slotIdx, trackId, roleId, locked) =>
      place(state, appId, slotIdx, trackId, roleId, locked),
    unplace: (appId, slotIdx) => {
      const slotId = state.slotIdByIdx.get(slotIdx);
      if (!slotId) return;
      const existing = state.assignments.get(assignmentKey(appId, slotId));
      if (!existing) return;
      state.assignments.delete(assignmentKey(appId, slotId));
      state.load.set(appId, Math.max(0, (state.load.get(appId) ?? 1) - 1));
      state.cellMembers.get(demandKey(slotId, existing.trackId, existing.roleId))?.delete(appId);
      state.appSlots.get(appId)?.delete(slotIdx);
    },
  };
}

const SLOT_A = "slot-0"; // idx 0, shared by both cells
const TRACK_A = "track-a";
const TRACK_B = "track-b";
const ROLE_A = "role-a";
const ROLE_B = "role-b";

function skill(level: Level) {
  return { level, pref: 2 as const };
}

function app(id: string, skills: Record<string, { level: Level; pref: 2 }>): SolverApplication {
  return { id, withdrawn: false, skills, availability: { [SLOT_A]: "o" } };
}

function inputWith(
  apps: SolverApplication[],
  demandOverrides: {
    aLeadMin?: number;
    aNewMax?: number;
    bLeadMin?: number;
    bNewMax?: number;
  } = {},
): SolverInput {
  const demands = new Map([
    [
      demandKey(SLOT_A, TRACK_A, ROLE_A),
      {
        min: 1,
        ideal: 2,
        leadMin: demandOverrides.aLeadMin ?? 0,
        newMax: demandOverrides.aNewMax ?? 5,
      },
    ],
    [
      demandKey(SLOT_A, TRACK_B, ROLE_B),
      {
        min: 1,
        ideal: 2,
        leadMin: demandOverrides.bLeadMin ?? 0,
        newMax: demandOverrides.bNewMax ?? 5,
      },
    ],
  ]);
  return {
    slots: [{ id: SLOT_A, idx: 0 }],
    tracks: [{ id: TRACK_A }, { id: TRACK_B }],
    roles: [{ id: ROLE_A }, { id: ROLE_B }],
    demands,
    applications: apps,
    options: { noSoloNewcomer: true, maxConsecutive: 4, seed: 1 },
  };
}

describe("ojtSwap", () => {
  it("swaps a newcomer-only cell's member with an experienced member from another cell in the same slot", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const expert = app("expert", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    // B needs a second experienced member so it still has one left after
    // "expert" moves to A — see the "loses its only experienced member" test
    // below for the case where B does NOT have this spare.
    const spare = app("spare", { [ROLE_B]: skill("exp") });
    const input = inputWith([newcomer, expert, spare]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "expert", 0, TRACK_B, ROLE_B, false);
    place(state, "spare", 0, TRACK_B, ROLE_B, false);

    ojtSwap(state, movers);

    expect(state.assignments.get(assignmentKey("newcomer", SLOT_A))).toEqual({
      trackId: TRACK_B,
      roleId: ROLE_B,
      locked: false,
    });
    expect(state.assignments.get(assignmentKey("expert", SLOT_A))).toEqual({
      trackId: TRACK_A,
      roleId: ROLE_A,
      locked: false,
    });
  });

  it("does not swap when the destination cell would lose its only experienced member", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const expert = app("expert", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    const input = inputWith([newcomer, expert]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    // B has exactly one member ("expert") — swapping it out would leave B
    // with zero experienced people, so `remainingExperienced` must block it.
    place(state, "expert", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    expect(state.assignments).toEqual(before);
  });

  it("does not swap when it would break the destination cell's leadMin", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const lead1 = app("lead1", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("lead") });
    const lead2 = app("lead2", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("lead") });
    const input = inputWith([newcomer, lead1, lead2], { bLeadMin: 2 });
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "lead1", 0, TRACK_B, ROLE_B, false);
    place(state, "lead2", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    // Removing either lead drops B's lead count from 2 to 1, below leadMin=2
    // — both candidates fail, so no swap happens at all.
    expect(state.assignments).toEqual(before);
  });

  it("does not swap when it would exceed the destination cell's newMax", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const exp1 = app("exp1", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    const exp2 = app("exp2", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    const input = inputWith([newcomer, exp1, exp2], { bNewMax: 0 });
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "exp1", 0, TRACK_B, ROLE_B, false);
    place(state, "exp2", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    // Moving the "new"-at-B newcomer into B would make B's newcomer count 1,
    // over newMax=0 — fails for both exp1 and exp2 candidates.
    expect(state.assignments).toEqual(before);
  });

  it("does not swap when the newcomer has no skill record for B's role at all", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new") }); // no ROLE_B entry
    const expert = app("expert", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    const spare = app("spare", { [ROLE_B]: skill("exp") }); // keeps B's remainingExperienced true
    const input = inputWith([newcomer, expert, spare]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "expert", 0, TRACK_B, ROLE_B, false);
    place(state, "spare", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    expect(state.assignments).toEqual(before);
  });

  it("requires the experienced candidate to be experienced at A's specific role, not just B's", () => {
    // "expert" is experienced at ROLE_B but only a newcomer at ROLE_A — must
    // not be treated as a valid mentor for cell A.
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const mixedLevel = app("mixed", { [ROLE_A]: skill("new"), [ROLE_B]: skill("exp") });
    const spare = app("spare", { [ROLE_B]: skill("exp") }); // keeps B's remainingExperienced true
    const input = inputWith([newcomer, mixedLevel, spare]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "mixed", 0, TRACK_B, ROLE_B, false);
    place(state, "spare", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    expect(state.assignments).toEqual(before);
  });

  it("never touches a locked assignment on either side of the swap", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new"), [ROLE_B]: skill("new") });
    const expert = app("expert", { [ROLE_A]: skill("exp"), [ROLE_B]: skill("exp") });
    const input = inputWith([newcomer, expert]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, true); // locked newcomer
    place(state, "expert", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    expect(state.assignments).toEqual(before);
  });

  it("leaves an already-mixed cell (not all newcomers) untouched", () => {
    const newcomer = app("newcomer", { [ROLE_A]: skill("new") });
    const expInA = app("expInA", { [ROLE_A]: skill("exp") });
    const expert = app("expert", { [ROLE_B]: skill("exp") });
    const input = inputWith([newcomer, expInA, expert]);
    const state = buildState(input, 1);
    const movers = makeMovers(state);
    place(state, "newcomer", 0, TRACK_A, ROLE_A, false);
    place(state, "expInA", 0, TRACK_A, ROLE_A, false);
    place(state, "expert", 0, TRACK_B, ROLE_B, false);
    const before = new Map(state.assignments);

    ojtSwap(state, movers);

    expect(state.assignments).toEqual(before);
  });
});
