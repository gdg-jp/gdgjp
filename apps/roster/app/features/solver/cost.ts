import {
  type Assignments,
  type SolverApplication,
  type SolverSlot,
  assignmentKey,
  getAvailability,
} from "./types";

/**
 * Everything `candidateCost` needs, kept intentionally narrow (not the full
 * engine state from solve.ts) so this file has zero dependency on solve.ts —
 * `EngineState` there is a structural superset of this and is passed in as-is
 * wherever `solve.ts` calls this function.
 */
export type CostContext = {
  readonly assignments: Assignments;
  readonly load: ReadonlyMap<string, number>;
  readonly slotIdByIdx: ReadonlyMap<number, string>;
  readonly rng: () => number;
  readonly maxConsecutive: number;
};

/**
 * §5.3's candidate cost table, applied exactly as specified —
 * docs/roster/06-solver.md Design §5. Lower is better; this is a
 * dissatisfaction-minimization score, not a fitness score, so every row is a
 * penalty (or a negative penalty = reward) rather than a point award.
 *
 * Called on candidates that have already passed `hardViolations` during
 * auto-generation (solve.ts's `fillCell`, local-search.ts's recipient search),
 * but this function itself makes no such assumption — it is also safe to call
 * on an arbitrary (app, slot, track, role) tuple, which is what makes it
 * reusable if a later stage wants a raw desirability score outside the solver
 * (`suggestFor` in suggest.ts deliberately does NOT use this — see its own
 * doc comment for why).
 */
export function candidateCost(
  ctx: CostContext,
  app: SolverApplication,
  slot: SolverSlot,
  trackId: string,
  roleId: string,
): number {
  // Availability: "x" is a hard constraint, so it must dominate every other
  // term unconditionally. "d" is a soft fallback, only worth using once "o"
  // candidates run out.
  const availability = getAvailability(app, slot.id);
  if (availability === "x") return Number.POSITIVE_INFINITY;

  let cost = availability === "d" ? 4.5 : 0;

  // First-choice reward: staff are unpaid volunteers — a schedule full of
  // roles nobody asked for is why they don't come back next time
  // (index.md §1 "希望の尊重...次回の供給を確保するための投資").
  const skill = app.skills[roleId];
  if (skill?.pref === 1) cost += -6;
  else if (skill?.pref === 2) cost += 0;
  else cost += 3; // no skill record — index.md §3's "pref なしは3として扱う"

  // Load fairness: every existing assignment this run raises the cost of
  // giving this person yet another one, so the greedy fill naturally spreads
  // work instead of piling onto whoever happens to sort first.
  cost += 1.6 * (ctx.load.get(app.id) ?? 0);

  // Continuity vs. track-switch: only meaningful once there is a previous
  // slot to compare against (slot.idx > 0). Same track AND role is a
  // continuation (fewer handoffs); a different track costs movement time.
  // Same track but a different role is neither — left at 0 deliberately.
  if (slot.idx > 0) {
    const prevSlotId = ctx.slotIdByIdx.get(slot.idx - 1);
    const prev = prevSlotId ? ctx.assignments.get(assignmentKey(app.id, prevSlotId)) : undefined;
    if (prev) {
      if (prev.trackId === trackId && prev.roleId === roleId) cost += -3.5;
      else if (prev.trackId !== trackId) cost += 1.2;
    }
  }

  // Consecutive-run cap: walk backward through contiguous prior slots this
  // app already holds an assignment in (any track/role) to find the streak
  // length placing here would create, then price it against maxConsecutive.
  let streak = 1;
  for (let idx = slot.idx - 1; idx >= 0; idx--) {
    const prevSlotId = ctx.slotIdByIdx.get(idx);
    if (!prevSlotId || !ctx.assignments.has(assignmentKey(app.id, prevSlotId))) break;
    streak++;
  }
  if (streak === ctx.maxConsecutive) cost += 12;
  else if (streak === ctx.maxConsecutive - 1) cost += 4;

  // Spread leads across tracks/roles rather than stacking them in one place.
  if (skill?.level === "lead") cost += 0.8;

  // Deterministic tiebreak. Always the last term, always exactly one rng()
  // draw per call, so the sequence of draws is fully determined by the fixed
  // iteration order callers use — never by object identity or hash order.
  cost += ctx.rng() * 0.4;

  return cost;
}
