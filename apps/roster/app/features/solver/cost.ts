import {
  type Assignments,
  type SolverApplication,
  type SolverSlot,
  assignmentKey,
  getAvailability,
} from "./types";

export type CostContext = {
  readonly assignments: Assignments;
  readonly load: ReadonlyMap<string, number>;
  readonly slotIdByIdx: ReadonlyMap<number, string>;
  readonly rng: () => number;
  readonly maxConsecutive: number;
};

export function candidateCost(
  ctx: CostContext,
  app: SolverApplication,
  slot: SolverSlot,
  trackId: string,
  roleId: string,
): number {
  const availability = getAvailability(app, slot.id);
  if (availability === "x") return Number.POSITIVE_INFINITY;

  let cost = availability === "d" ? 4.5 : 0;

  const skill = app.skills[roleId];
  if (skill?.pref === 1) cost += -6;
  else if (skill?.pref === 2) cost += 0;
  else cost += 3;

  cost += 1.6 * (ctx.load.get(app.id) ?? 0);

  if (slot.idx > 0) {
    const prevSlotId = ctx.slotIdByIdx.get(slot.idx - 1);
    const prev = prevSlotId ? ctx.assignments.get(assignmentKey(app.id, prevSlotId)) : undefined;
    if (prev) {
      if (prev.trackId === trackId && prev.roleId === roleId) cost += -3.5;
      else if (prev.trackId !== trackId) cost += 1.2;
    }
  }

  let streak = 1;
  for (let idx = slot.idx - 1; idx >= 0; idx--) {
    const prevSlotId = ctx.slotIdByIdx.get(idx);
    if (!prevSlotId || !ctx.assignments.has(assignmentKey(app.id, prevSlotId))) break;
    streak++;
  }
  if (streak === ctx.maxConsecutive) cost += 12;
  else if (streak === ctx.maxConsecutive - 1) cost += 4;

  if (skill?.level === "lead") cost += 0.8;

  cost += ctx.rng() * 0.4;

  return cost;
}
