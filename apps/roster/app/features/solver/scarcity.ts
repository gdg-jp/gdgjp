import { type SolverInput, getAvailability, parseDemandKey } from "./types";

/** A demand cell (index.md §4) with its `Demand` fields flattened alongside
 * the location it identifies, plus the slot's `idx` pre-resolved — every
 * downstream consumer (solve.ts's fill phases) wants these together. */
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

/**
 * §5.2 step ① (docs/roster/06-solver.md Design §4 "① 需要セルを希少度順に並べる").
 * Orders every demand cell by how scarce its usable candidate pool is, so
 * phases ②-④ (docs/roster/06-solver.md's lead-fill / min-fill / ideal-fill)
 * exhaust the hardest-to-satisfy cells first — filling easy cells first would
 * let them eat from the same shared pool of staff that a scarce cell needs.
 *
 * This computation is static: it only reads `input` (who CAN staff a cell,
 * not who currently DOES), so it runs once, before any assignment exists,
 * and its result is reused unchanged across all three greedy fill passes.
 *
 * `ideal === 0` cells are dropped entirely — index.md §4: "ある役割が必要ない
 * 時間帯は行を持たないか ideal = 0" — the two are defined to mean the same
 * "not needed", so a zero-ideal row is not a cell at all here.
 */
export function orderDemandCells(input: SolverInput): DemandCell[] {
  const slotIdxById = new Map(input.slots.map((slot) => [slot.id, slot.idx]));
  const scored: Array<DemandCell & { scarcity: number }> = [];

  for (const [key, demand] of input.demands) {
    if (demand.ideal === 0) continue;
    const { slotId, trackId, roleId } = parseDemandKey(key);
    const slotIdx = slotIdxById.get(slotId);
    if (slotIdx === undefined) continue; // defensive: demand referencing an unknown slot

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

    // leadMin === 0 uses a fixed pressure of 5 specifically so cells with no
    // lead requirement sort AFTER cells that have one — filling
    // lead-constrained cells first prevents leads from being consumed
    // elsewhere before the cells that actually require them are reached.
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

  // Ascending scarcity (scarcest first); ties broken by slot idx ascending
  // (docs/roster/06-solver.md Design §4: "同値なら slot.idx 昇順").
  scored.sort((a, b) => a.scarcity - b.scarcity || a.slotIdx - b.slotIdx);
  return scored.map(({ scarcity: _scarcity, ...cell }) => cell);
}
