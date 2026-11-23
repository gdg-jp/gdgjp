import { hardViolations } from "./constraints";
import { type Assignments, type SolverInput, assignmentKey, getAvailability } from "./types";

export type SuggestionCategory = "free-o" | "free-d" | "busy" | "unavailable";

export type Suggestion = {
  applicationId: string;
  category: SuggestionCategory;
  pref: 1 | 2 | 3;
  warnings: string[];
};

const CATEGORY_RANK: Record<SuggestionCategory, number> = {
  "free-o": 0,
  "free-d": 1,
  busy: 2,
  unavailable: 3,
};

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
