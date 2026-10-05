import {
  type Assignments,
  type SolverApplication,
  type SolverInput,
  type SolverSlot,
  assignmentKey,
  demandKey,
  getAvailability,
} from "./types";

/**
 * The 5 conditions auto-generation may never violate (index.md §5.1 items
 * 1-4 and 6; item 5 — skill-mix — is deliberately NOT checked here, see
 * below). docs/roster/06-solver.md Design §2.
 *
 * This function is reused verbatim by Stage 07's manual-edit flow, which
 * only WARNS on a non-empty result and still lets the edit through — there
 * is a real day-of-event need to override these (index.md §5.1: "手動編集
 * ではこれらを警告のうえ許可する"). That is why this returns a list of
 * human-readable warning strings instead of a boolean or throwing: a
 * boolean gate would invite someone to "simplify" this into a block later,
 * which would break the documented asymmetry between auto-generate (never
 * violates) and manual edit (warns, then allows).
 *
 * `solve()` is the only caller that treats a non-empty result as "do not
 * place this candidate" — that policy lives in solve.ts, not here.
 *
 * **Each message states the constraint, never who violated it.** This module
 * is pure (ADR-004), so `SolverApplication` carries no display name — the
 * messages used to interpolate `app.id` and surfaced as literal
 * "app-2 はこの役割を担当できません" in the manual-edit drawers. Both callers
 * already render the person's name immediately above the warning list
 * (`CellDrawer`'s title is the applicant; `DemandCellDrawer` labels every
 * candidate row), so a subject here is redundant on top of unreadable. Keep
 * new messages subject-free for the same reason.
 *
 * Skill-mix conditions (`leadMin` / `newMax` / no-solo-newcomer) are
 * intentionally NOT part of this function. index.md §5.1 item 5 groups them
 * with the other hard constraints, but 06-solver.md Design §2 carves them out
 * to the caller's candidate filter because they depend on which OTHER people
 * are already in the same cell — information a per-candidate check like this
 * one would have to duplicate from solve.ts's fill loop. See fillCell's
 * `newcomerAllowed` in solve.ts and local-search.ts / ojt-swap.ts's own
 * leadMin/newMax checks around each move.
 */
export function hardViolations(
  input: SolverInput,
  app: SolverApplication,
  slot: SolverSlot,
  trackId: string,
  roleId: string,
  assignments: Assignments,
): string[] {
  const warnings: string[] = [];

  if (assignments.has(assignmentKey(app.id, slot.id))) {
    warnings.push("既にこの時間枠に割り当てられています（1人2箇所は不可）");
  }

  if (!app.skills[roleId]) {
    warnings.push("この役割を担当できません（スキル登録がありません）");
  }

  if (getAvailability(app, slot.id) === "x") {
    warnings.push("この時間枠は稼働不可（×）です");
  }

  if (app.withdrawn) {
    warnings.push("辞退済みです");
  }

  const demand = input.demands.get(demandKey(slot.id, trackId, roleId));
  if (!demand || demand.ideal === 0) {
    warnings.push("この時間枠・トラック・役割の組み合わせには需要がありません");
  }

  return warnings;
}
