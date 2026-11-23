import { type SolverInput, getAvailability, parseDemandKey } from "./types";

export type DemandCell = {
  slotId: string;
  slotIdx: number;
  trackId: string;
  roleId: string;
  min: number;
  ideal: number;
  leadMin: number;
  newMax: number;
};

export function orderDemandCells(input: SolverInput): DemandCell[] {
  const slotIdxById = new Map(input.slots.map((slot) => [slot.id, slot.idx]));
  const scored: Array<DemandCell & { scarcity: number }> = [];

  for (const [key, demand] of input.demands) {
    if (demand.ideal === 0) continue;
    const { slotId, trackId, roleId } = parseDemandKey(key);
    const slotIdx = slotIdxById.get(slotId);
    if (slotIdx === undefined) continue;

    let eligible = 0;
    let leads = 0;
    for (const app of input.applications) {
      if (app.withdrawn) continue;
      const skill = app.skills[roleId];
      if (!skill) continue;
      if (getAvailability(app, slotId) === "x") continue;
      eligible++;
      if (skill.level === "lead") leads++;
    }

    const leadPressure = demand.leadMin > 0 ? (leads - demand.leadMin) * 0.5 : 5;
    const scarcity = eligible - demand.min + leadPressure;

    scored.push({
      slotId,
      slotIdx,
      trackId,
      roleId,
      min: demand.min,
      ideal: demand.ideal,
      leadMin: demand.leadMin,
      newMax: demand.newMax,
      scarcity,
    });
  }

  scored.sort((a, b) => a.scarcity - b.scarcity || a.slotIdx - b.slotIdx);
  return scored.map(({ scarcity: _scarcity, ...cell }) => cell);
}
