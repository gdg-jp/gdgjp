import { hardViolations } from "./constraints";
import { type CostContext, candidateCost } from "./cost";
import type { EngineState, Movers } from "./solve";
import {
  type Demand,
  type Level,
  type SolverApplication,
  demandKey,
  getAvailability,
} from "./types";

const MAX_PASSES = 40;
const CONVERGED_SPREAD = 2;

function levelFor(state: EngineState, appId: string, roleId: string): Level | undefined {
  return state.appsById.get(appId)?.skills[roleId]?.level;
}

function countLevel(
  state: EngineState,
  members: ReadonlySet<string> | undefined,
  roleId: string,
  level: Level,
): number {
  if (!members) return 0;
  let n = 0;
  for (const id of members) if (levelFor(state, id, roleId) === level) n++;
  return n;
}

/** Would moving `mover`'s seat to `recipient` still satisfy `demand`'s
 * leadMin/newMax? (docs/roster/06-solver.md Design §4 step ⑤: "移した結果
 * leadMin を割る、または newMax を超える場合は移さない".) */
function canReceive(
  state: EngineState,
  recipient: SolverApplication,
  mover: SolverApplication,
  slot: { id: string; idx: number },
  trackId: string,
  roleId: string,
  demand: Demand,
  currentLeadCount: number,
  currentNewCount: number,
): boolean {
  if (recipient.id === mover.id) return false;
  if (getAvailability(recipient, slot.id) !== "o") return false; // "d" is never used to receive a moved shift
  if (hardViolations(state.input, recipient, slot, trackId, roleId, state.assignments).length > 0)
    return false;

  const moverLevel = mover.skills[roleId]?.level;
  const recipientLevel = recipient.skills[roleId]?.level;
  const nextLead =
    currentLeadCount - (moverLevel === "lead" ? 1 : 0) + (recipientLevel === "lead" ? 1 : 0);
  if (nextLead < demand.leadMin) return false;
  const nextNew =
    currentNewCount - (moverLevel === "new" ? 1 : 0) + (recipientLevel === "new" ? 1 : 0);
  if (nextNew > demand.newMax) return false;

  return true;
}

/**
 * §5.5 / docs/roster/06-solver.md Design §4 step ⑤ — evens out load without
 * chasing an exact solution. Each pass moves exactly ONE unlocked assignment
 * from the currently-heaviest staff member to an equally-or-less-loaded,
 * "o"-available staff member, and the whole search stops the moment the
 * spread is small enough or a pass can't move anything ("1パスで1件も移せな
 * ければ打ち切る" — this is read literally: a pass attempts exactly one move,
 * and a failed attempt ends the search, it does not retry with a different
 * mover or a different one of their assignments).
 *
 * `state` is read directly (loads, current assignments, skills); every
 * mutation goes through `movers.place` / `movers.unplace` so `EngineState`'s
 * four bookkeeping maps never drift out of sync with each other.
 */
export function localSearch(state: EngineState, costCtx: CostContext, movers: Movers): void {
  const pool = state.input.applications.filter((app) => !app.withdrawn);
  if (pool.length === 0) return;
  const loadOf = (app: SolverApplication): number => state.load.get(app.id) ?? 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const loads = pool.map(loadOf);
    const maxLoad = Math.max(...loads);
    const minLoad = Math.min(...loads);
    if (maxLoad - minLoad <= CONVERGED_SPREAD) return;

    const heaviest = pool.filter((app) => loadOf(app) === maxLoad);
    const mover = heaviest[Math.floor(state.rng() * heaviest.length)];
    const moverSlots = state.appSlots.get(mover.id);
    const movable = moverSlots
      ? [...moverSlots.entries()].filter(([, value]) => !value.locked)
      : [];
    if (movable.length === 0) return;

    const [slotIdx, current] = movable[Math.floor(state.rng() * movable.length)];
    const slotId = state.slotIdByIdx.get(slotIdx);
    if (!slotId) return;
    const slot = { id: slotId, idx: slotIdx };
    const dKey = demandKey(slotId, current.trackId, current.roleId);
    const demand = state.input.demands.get(dKey);
    if (!demand) return;

    const members = state.cellMembers.get(dKey);
    const leadCount = countLevel(state, members, current.roleId, "lead");
    const newCount = countLevel(state, members, current.roleId, "new");

    let best: SolverApplication | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const candidate of pool) {
      if (loadOf(candidate) > minLoad) continue;
      if (
        !canReceive(
          state,
          candidate,
          mover,
          slot,
          current.trackId,
          current.roleId,
          demand,
          leadCount,
          newCount,
        )
      ) {
        continue;
      }
      const cost = candidateCost(costCtx, candidate, slot, current.trackId, current.roleId);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }

    if (!best) return; // nothing valid to move to this pass — stop per spec

    movers.unplace(mover.id, slotIdx);
    movers.place(best.id, slotIdx, current.trackId, current.roleId, false);
  }
}
