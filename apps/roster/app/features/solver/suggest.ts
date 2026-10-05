import { hardViolations } from "./constraints";
import { type Assignments, type SolverInput, assignmentKey, getAvailability } from "./types";

export type SuggestionCategory = "free-o" | "free-d" | "busy" | "unavailable";

export type Suggestion = {
  applicationId: string;
  category: SuggestionCategory;
  /** 3 = no skill record for this role (index.md §3's internal convention). */
  pref: 1 | 2 | 3;
  warnings: string[];
};

const CATEGORY_RANK: Record<SuggestionCategory, number> = {
  "free-o": 0,
  "free-d": 1,
  busy: 2,
  unavailable: 3,
};

/**
 * docs/roster/06-solver.md Design §7 — every candidate for a cell, for
 * Stage 07's manual-edit UI. Order: free+"o" -> free+"d" -> already busy this
 * slot -> unavailable, tie-broken by pref ascending.
 *
 * Unlike `solve()`'s greedy fill, this returns EVERY applicant, including
 * ones `hardViolations` would reject — index.md §5.1: manual editing warns
 * instead of blocking, and dropping a candidate from the list would hide
 * *why* they're a bad fit instead of explaining it via `warnings`. This is
 * also why this does not rank by `candidateCost`: that score bakes in
 * fairness/continuity preferences meant to steer automatic generation, not to
 * second-guess an owner who is looking at a specific person for a reason.
 */
export function suggestFor(
  input: SolverInput,
  assignments: Assignments,
  slotId: string,
  trackId: string,
  roleId: string,
): Suggestion[] {
  const slotIdx = input.slots.find((s) => s.id === slotId)?.idx ?? 0;
  const slot = { id: slotId, idx: slotIdx };

  const suggestions: Suggestion[] = input.applications.map((app) => {
    const availability = getAvailability(app, slotId);
    const alreadyBusy = assignments.has(assignmentKey(app.id, slotId));
    const category: SuggestionCategory =
      availability === "x"
        ? "unavailable"
        : alreadyBusy
          ? "busy"
          : availability === "o"
            ? "free-o"
            : "free-d";
    const skill = app.skills[roleId];
    const pref: 1 | 2 | 3 = skill ? skill.pref : 3;
    const warnings = hardViolations(input, app, slot, trackId, roleId, assignments);
    return { applicationId: app.id, category, pref, warnings };
  });

  suggestions.sort(
    (a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] || a.pref - b.pref,
  );
  return suggestions;
}
