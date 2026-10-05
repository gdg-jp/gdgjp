import {
  type Assignments,
  type Metrics,
  type Report,
  type Shortage,
  type SolverInput,
  type Violation,
  demandKey,
  parseAssignmentKey,
  parseDemandKey,
} from "./types";

function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function longestStreak(idxs: readonly number[]): number {
  const sorted = [...idxs].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let prev = Number.NEGATIVE_INFINITY;
  for (const idx of sorted) {
    current = idx === prev + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prev = idx;
  }
  return longest;
}

/**
 * §5.7 / docs/roster/06-solver.md Design §6 — evaluates ANY assignments map
 * against the demand, independent of how it was produced. `solve()`'s step
 * ⑦ calls this on its own output, but Stage 07's manual-edit flow and
 * Stage 08's history comparison both re-run this same function on
 * hand-edited or historical assignments — this file must not import
 * anything from solve.ts (or hold any state) so that stays true.
 *
 * Shortages ("not filled") and violations ("filled, but breaking a rule")
 * are kept in separate arrays — index.md §5.7 is explicit that mixing them
 * makes it impossible to turn a report into a recruiting call to action
 * ("配信経験者を募集中" needs to know it's a LEAD shortage, not a headcount one).
 */
export function evaluate(input: SolverInput, assignments: Assignments): Report {
  const appsById = new Map(input.applications.map((a) => [a.id, a]));
  const slotIdxById = new Map(input.slots.map((s) => [s.id, s.idx]));

  const membersByCell = new Map<string, string[]>();
  const loadByApp = new Map<string, number>();
  const appSlotIdxs = new Map<string, number[]>();
  let softUsed = 0;
  let firstChoiceCount = 0;

  for (const [key, value] of assignments) {
    const { applicationId, slotId } = parseAssignmentKey(key);
    const cellKey = demandKey(slotId, value.trackId, value.roleId);
    const members = membersByCell.get(cellKey);
    if (members) members.push(applicationId);
    else membersByCell.set(cellKey, [applicationId]);

    loadByApp.set(applicationId, (loadByApp.get(applicationId) ?? 0) + 1);

    const slotIdx = slotIdxById.get(slotId);
    if (slotIdx !== undefined) {
      const list = appSlotIdxs.get(applicationId);
      if (list) list.push(slotIdx);
      else appSlotIdxs.set(applicationId, [slotIdx]);
    }

    const app = appsById.get(applicationId);
    if (app) {
      if ((app.availability[slotId] ?? "x") === "d") softUsed++;
      if (app.skills[value.roleId]?.pref === 1) firstChoiceCount++;
    }
  }

  const shortages: Shortage[] = [];
  const violations: Violation[] = [];
  let demandMin = 0;
  let demandIdeal = 0;
  let filled = 0;
  let minShortageTotal = 0;
  let leadShortageTotal = 0;

  for (const [key, demand] of input.demands) {
    if (demand.ideal === 0) continue; // no row and ideal=0 are the same "not needed"
    const { slotId, trackId, roleId } = parseDemandKey(key);
    const members = membersByCell.get(key) ?? [];

    demandMin += demand.min;
    demandIdeal += demand.ideal;
    filled += Math.min(members.length, demand.ideal);

    if (members.length < demand.min) {
      const amount = demand.min - members.length;
      minShortageTotal += amount;
      shortages.push({ kind: "headcount", slotId, trackId, roleId, amount });
    }

    let leadCount = 0;
    let newCount = 0;
    let hasExperienced = false;
    for (const id of members) {
      const level = appsById.get(id)?.skills[roleId]?.level;
      if (level === "lead") {
        leadCount++;
        hasExperienced = true;
      } else if (level === "exp") {
        hasExperienced = true;
      } else if (level === "new") {
        newCount++;
      }
    }

    if (leadCount < demand.leadMin) {
      const amount = demand.leadMin - leadCount;
      leadShortageTotal += amount;
      shortages.push({ kind: "lead", slotId, trackId, roleId, amount });
    }

    if (newCount > demand.newMax) {
      violations.push({
        kind: "newcomerOver",
        slotId,
        trackId,
        roleId,
        amount: newCount - demand.newMax,
      });
    }

    if (input.options.noSoloNewcomer && members.length > 0 && !hasExperienced) {
      violations.push({ kind: "soloNewcomer", slotId, trackId, roleId, amount: members.length });
    }

    if (members.length > demand.ideal) {
      violations.push({
        kind: "over",
        slotId,
        trackId,
        roleId,
        amount: members.length - demand.ideal,
      });
    }
  }

  const eligibleApps = input.applications.filter((a) => !a.withdrawn);
  const loads = eligibleApps.map((a) => loadByApp.get(a.id) ?? 0);
  const overwork = eligibleApps.filter(
    (a) => longestStreak(appSlotIdxs.get(a.id) ?? []) > input.options.maxConsecutive,
  ).length;
  const assigned = assignments.size;

  const metrics: Metrics = {
    demandMin,
    demandIdeal,
    filled,
    idealRate: demandIdeal > 0 ? filled / demandIdeal : 1,
    minShortage: minShortageTotal,
    leadShortage: leadShortageTotal,
    assigned,
    firstChoiceRate: assigned > 0 ? firstChoiceCount / assigned : 0,
    loadStdev: stdev(loads),
    loadMax: loads.length > 0 ? Math.max(...loads) : 0,
    loadMin: loads.length > 0 ? Math.min(...loads) : 0,
    softUsed,
    overwork,
    violationCount: violations.length,
  };

  return { shortages, violations, metrics };
}
