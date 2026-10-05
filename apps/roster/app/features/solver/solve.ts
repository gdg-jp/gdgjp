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

/**
 * Mutable engine state shared by every phase in the 7-step flow
 * (docs/roster/index.md §5.2, docs/roster/06-solver.md Design §4). The four
 * maps below are kept in sync ONLY by `place`/`unplace` in this file — every
 * read from local-search.ts / ojt-swap.ts goes through this same state via
 * the `Movers` functions they're handed, so there is exactly one place that
 * can produce an inconsistency between `assignments`, `load`, `cellMembers`,
 * and `appSlots`.
 *
 * Exported so local-search.ts / ojt-swap.ts can type their `state` parameter
 * against it. This does not create a runtime circular import: both of those
 * modules only ever write `import type { EngineState, Movers } from "./solve"`,
 * which — under this repo's `verbatimModuleSyntax` — is fully erased at
 * compile time. They receive the actual functions to call (`localSearch`,
 * `ojtSwap`) as ordinary value imports going the other direction (this file
 * imports them), so the dependency graph has no runtime cycle.
 */
export type EngineState = {
  readonly input: SolverInput;
  readonly rng: () => number;
  readonly assignments: Assignments;
  readonly load: Map<string, number>;
  /** demandKey -> the set of applicationIds currently in that cell. */
  readonly cellMembers: Map<string, Set<string>>;
  /** applicationId -> (slotIdx -> that app's assignment in that slot). */
  readonly appSlots: Map<string, Map<number, AssignmentValue>>;
  readonly slotIdxById: Map<string, number>;
  readonly slotIdByIdx: Map<number, string>;
  readonly appsById: Map<string, SolverApplication>;
};

/** The only way local-search.ts / ojt-swap.ts may mutate `EngineState` — see
 * the module doc comment above for why this is dependency-injected rather
 * than imported as a value. */
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

/** Seeds `state` with the caller's previously-locked assignments, per
 * `SolverInput.existingAssignments`'s doc comment. Only consulted when
 * `opts.keepLocked` is true. */
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

/**
 * The newcomer candidate filter shared by steps ③ and ④ (docs/roster/06-solver.md
 * Design §4): a "new" candidate is excluded once the cell already has `newMax`
 * newcomers, or — when `noSoloNewcomer` is on — once they would fill the LAST
 * remaining seat with nobody experienced already present. Checking "last seat"
 * rather than every seat is deliberate: rejecting newcomers earlier would leave
 * the cell permanently short, since nothing guarantees an experienced person
 * shows up later in this pass.
 */
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

  // Bug fix: this must count only "new"-level members already in the cell,
  // not `currentSize` (every member regardless of level). Comparing against
  // `currentSize` made any cell with `leadMin >= 1` block newcomers as soon
  // as the required lead was placed, even with zero newcomers seated —
  // exactly the leadMin+newMax combination index.md §5.2 illustrates as the
  // primary example ("受付は常時1名以上のリード経験者" + "初参加者は1名まで").
  // `local-search.ts#countLevel` / `ojt-swap.ts#countLevelIn` already count
  // this correctly; this brings `newcomerAllowed` in line with them.
  const currentNewCount = levelsInCell.filter((level) => level === "new").length;
  if (currentNewCount >= cell.newMax) return false;
  if (!state.input.options.noSoloNewcomer) return true;

  const hasExperienced = levelsInCell.some((level) => level === "exp" || level === "lead");
  if (hasExperienced) return true;
  return currentSize !== target - 1;
}

/**
 * Greedily fills one cell up to `target`, re-scanning every application on
 * each seat (not just once per cell) because `candidateCost`'s load term
 * changes after every placement anywhere in the input — a candidate who
 * looked best for this cell's first seat may not be best for its second.
 */
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

    if (!best) return; // can't reach target with the remaining pool — evaluate() reports the gap
    movers.place(best.id, cell.slotIdx, cell.trackId, cell.roleId, false);
  }
}

/** Step ② — fills each cell's `leadMin` using only "lead"-level candidates. */
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
      () => true, // never reached: a "lead" candidate is never level "new"
    );
  }
}

/** Steps ③ (target = min) and ④ (target = ideal) — any level is eligible,
 * subject to the newcomer filter above. */
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

/**
 * Runs the full 7-step flow (docs/roster/index.md §5.2) and returns the
 * resulting assignments plus an evaluation report (step ⑦). Calling this
 * twice with the same `input` and the same effective seed (`opts.seed` if
 * given, else `input.options.seed`) MUST return a deeply-equal
 * `Assignments` map both times — see solve.test.ts's determinism test.
 */
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

  const cells = orderDemandCells(input); // step ①
  fillLeadMins(state, costCtx, movers, cells); // step ②
  fillToTarget(state, costCtx, movers, cells, (cell) => cell.min); // step ③
  fillToTarget(state, costCtx, movers, cells, (cell) => cell.ideal); // step ④
  localSearch(state, costCtx, movers); // step ⑤
  ojtSwap(state, movers); // step ⑥

  const report: Report = evaluate(input, state.assignments); // step ⑦
  return { assignments: state.assignments, report };
}
