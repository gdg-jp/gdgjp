import { hardViolations } from "./constraints";
import { type CostContext, candidateCost } from "./cost";
import { evaluate } from "./evaluate";
import { localSearch } from "./local-search";
import { ojtSwap } from "./ojt-swap";
import { mulberry32 } from "./random";
import { type DemandCell, orderDemandCells } from "./scarcity";
import {
  type AssignmentValue,
  type Assignments,
  type Report,
  type SolveOptions,
  type SolverApplication,
  type SolverInput,
  type SolverResult,
  assignmentKey,
  demandKey,
  parseAssignmentKey,
} from "./types";

export type EngineState = {
  readonly input: SolverInput;
  readonly rng: () => number;
  readonly assignments: Assignments;
  readonly load: Map<string, number>;
  readonly cellMembers: Map<string, Set<string>>;
  readonly appSlots: Map<string, Map<number, AssignmentValue>>;
  readonly slotIdxById: Map<string, number>;
  readonly slotIdByIdx: Map<number, string>;
  readonly appsById: Map<string, SolverApplication>;
};

export type Movers = {
  place: (appId: string, slotIdx: number, trackId: string, roleId: string, locked: boolean) => void;
  unplace: (appId: string, slotIdx: number) => void;
};

function createState(input: SolverInput, seed: number): EngineState {
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

function seedExisting(state: EngineState, movers: Movers): void {
  const existing = state.input.existingAssignments;
  if (!existing) return;
  for (const [key, value] of existing) {
    if (!value.locked) continue;
    const { applicationId, slotId } = parseAssignmentKey(key);
    const slotIdx = state.slotIdxById.get(slotId);
    if (slotIdx === undefined) continue;
    movers.place(applicationId, slotIdx, value.trackId, value.roleId, true);
  }
}

function newcomerAllowed(
  state: EngineState,
  cell: DemandCell,
  currentSize: number,
  target: number,
): boolean {
  const members = state.cellMembers.get(demandKey(cell.slotId, cell.trackId, cell.roleId));
  const levelsInCell = members
    ? [...members].map((id) => state.appsById.get(id)?.skills[cell.roleId]?.level)
    : [];

  const currentNewCount = levelsInCell.filter((level) => level === "new").length;
  if (currentNewCount >= cell.newMax) return false;
  if (!state.input.options.noSoloNewcomer) return true;

  const hasExperienced = levelsInCell.some((level) => level === "exp" || level === "lead");
  if (hasExperienced) return true;
  return currentSize !== target - 1;
}

function fillCell(
  state: EngineState,
  costCtx: CostContext,
  movers: Movers,
  cell: DemandCell,
  target: number,
  levelGate: (app: SolverApplication) => boolean,
  newcomerGate: (currentSize: number) => boolean,
): void {
  if (target <= 0) return;
  const slot = { id: cell.slotId, idx: cell.slotIdx };
  const dKey = demandKey(cell.slotId, cell.trackId, cell.roleId);

  while ((state.cellMembers.get(dKey)?.size ?? 0) < target) {
    const currentSize = state.cellMembers.get(dKey)?.size ?? 0;
    let best: SolverApplication | undefined;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const app of state.input.applications) {
      if (
        hardViolations(state.input, app, slot, cell.trackId, cell.roleId, state.assignments)
          .length > 0
      )
        continue;
      if (!levelGate(app)) continue;
      if (app.skills[cell.roleId]?.level === "new" && !newcomerGate(currentSize)) continue;

      const cost = candidateCost(costCtx, app, slot, cell.trackId, cell.roleId);
      if (cost < bestCost) {
        bestCost = cost;
        best = app;
      }
    }

    if (!best) return;
    movers.place(best.id, cell.slotIdx, cell.trackId, cell.roleId, false);
  }
}

function fillLeadMins(
  state: EngineState,
  costCtx: CostContext,
  movers: Movers,
  cells: readonly DemandCell[],
): void {
  for (const cell of cells) {
    fillCell(
      state,
      costCtx,
      movers,
      cell,
      cell.leadMin,
      (app) => app.skills[cell.roleId]?.level === "lead",
      () => true,
    );
  }
}

function fillToTarget(
  state: EngineState,
  costCtx: CostContext,
  movers: Movers,
  cells: readonly DemandCell[],
  targetOf: (cell: DemandCell) => number,
): void {
  for (const cell of cells) {
    const target = targetOf(cell);
    fillCell(
      state,
      costCtx,
      movers,
      cell,
      target,
      () => true,
      (currentSize) => newcomerAllowed(state, cell, currentSize, target),
    );
  }
}

export function solve(input: SolverInput, opts?: SolveOptions): SolverResult {
  const seed = opts?.seed ?? input.options.seed;
  const state = createState(input, seed);
  const movers: Movers = {
    place: (appId, slotIdx, trackId, roleId, locked) =>
      place(state, appId, slotIdx, trackId, roleId, locked),
    unplace: (appId, slotIdx) => unplace(state, appId, slotIdx),
  };
  const costCtx: CostContext = {
    assignments: state.assignments,
    load: state.load,
    slotIdByIdx: state.slotIdByIdx,
    rng: state.rng,
    maxConsecutive: input.options.maxConsecutive,
  };

  if (opts?.keepLocked) seedExisting(state, movers);

  const cells = orderDemandCells(input);
  fillLeadMins(state, costCtx, movers, cells);
  fillToTarget(state, costCtx, movers, cells, (cell) => cell.min);
  fillToTarget(state, costCtx, movers, cells, (cell) => cell.ideal);
  localSearch(state, costCtx, movers);
  ojtSwap(state, movers);

  const report: Report = evaluate(input, state.assignments);
  return { assignments: state.assignments, report };
}
