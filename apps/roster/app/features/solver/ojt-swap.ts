import type { EngineState, Movers } from "./solve";
import { type Demand, type Level, assignmentKey, parseDemandKey } from "./types";

function isExperienced(level: Level | undefined): boolean {
  return level === "exp" || level === "lead";
}

function countLevelIn(
  state: EngineState,
  members: ReadonlySet<string>,
  roleId: string,
  level: Level,
): number {
  let n = 0;
  for (const id of members) if (state.appsById.get(id)?.skills[roleId]?.level === level) n++;
  return n;
}

type CellRef = { slotId: string; trackId: string; roleId: string };

function trySwap(
  state: EngineState,
  movers: Movers,
  aKey: string,
  a: CellRef,
  aDemand: Demand,
  aMembers: ReadonlySet<string>,
  candidateKeys: readonly string[],
): boolean {
  const slotIdx = state.slotIdxById.get(a.slotId);
  if (slotIdx === undefined) return false;

  for (const newcomerId of aMembers) {
    const newcomerAssignment = state.assignments.get(assignmentKey(newcomerId, a.slotId));
    if (!newcomerAssignment || newcomerAssignment.locked) continue;
    const newcomer = state.appsById.get(newcomerId);
    if (!newcomer) continue;

    for (const bKey of candidateKeys) {
      if (bKey === aKey) continue;
      const bMembers = state.cellMembers.get(bKey);
      if (!bMembers || bMembers.size === 0) continue;
      const b = parseDemandKey(bKey);
      const bDemand = state.input.demands.get(bKey);
      if (!bDemand) continue;

      if (!newcomer.skills[b.roleId]) continue;

      for (const expId of bMembers) {
        const expAssignment = state.assignments.get(assignmentKey(expId, b.slotId));
        if (!expAssignment || expAssignment.locked) continue;
        const exp = state.appsById.get(expId);
        if (!exp) continue;

        if (!isExperienced(exp.skills[a.roleId]?.level)) continue;

        const remainingExperienced = [...bMembers].some(
          (id) => id !== expId && isExperienced(state.appsById.get(id)?.skills[b.roleId]?.level),
        );
        if (!remainingExperienced) continue;

        const expIsLead = exp.skills[b.roleId]?.level === "lead";
        const newcomerLevelForB = newcomer.skills[b.roleId]?.level;
        const nextLeadInB =
          countLevelIn(state, bMembers, b.roleId, "lead") -
          (expIsLead ? 1 : 0) +
          (newcomerLevelForB === "lead" ? 1 : 0);
        if (nextLeadInB < bDemand.leadMin) continue;

        const nextNewInB =
          countLevelIn(state, bMembers, b.roleId, "new") + (newcomerLevelForB === "new" ? 1 : 0);
        if (nextNewInB > bDemand.newMax) continue;

        movers.unplace(newcomerId, slotIdx);
        movers.unplace(expId, slotIdx);
        movers.place(newcomerId, slotIdx, b.trackId, b.roleId, false);
        movers.place(expId, slotIdx, a.trackId, a.roleId, false);
        return true;
      }
    }
  }
  return false;
}

export function ojtSwap(state: EngineState, movers: Movers): void {
  const cellsBySlot = new Map<string, string[]>();
  for (const key of state.cellMembers.keys()) {
    const { slotId } = parseDemandKey(key);
    const list = cellsBySlot.get(slotId);
    if (list) list.push(key);
    else cellsBySlot.set(slotId, [key]);
  }

  for (const [aKey, aMembers] of state.cellMembers) {
    if (aMembers.size === 0) continue;
    const a = parseDemandKey(aKey);
    const allNew = [...aMembers].every(
      (id) => state.appsById.get(id)?.skills[a.roleId]?.level === "new",
    );
    if (!allNew) continue;

    const aDemand = state.input.demands.get(aKey);
    if (!aDemand) continue;

    trySwap(state, movers, aKey, a, aDemand, aMembers, cellsBySlot.get(a.slotId) ?? []);
  }
}
