/**
 * Domain types for the `assignments` table (docs/roster/index.md §4,
 * docs/roster/07-roster-manual-edit.md "Design" §1). The solver's OWN
 * `Assignments`/`AssignmentValue` types (`~/features/solver/types`) are the
 * shape `solve()`/`evaluate()`/`hardViolations()`/`suggestFor()` actually
 * operate on — this file only adds the D1 row shape
 * (`roster.server.ts#toAssignment`'s target) and the tiny view vocabulary
 * this feature's own components need. It deliberately does not re-declare
 * or wrap the solver's types: `app/features/roster/*` imports them directly
 * from `~/features/solver/types` everywhere a `SolverInput`/`Assignments`/
 * `Report` is needed, per docs/roster/07-roster-manual-edit.md "再利用する
 * 既存実装" ("呼ぶだけ。ロジックをルートに書き写さない").
 */

/** One row of the current shift table (docs/roster/index.md §4 "assignments"). */
export type AssignmentRecord = {
  eventId: string;
  rosterSheetId: string;
  applicationId: string;
  timeSlotId: string;
  trackId: string;
  roleId: string;
  locked: boolean;
};

/** The 3 internal views `/e/:id/roster` switches between (docs/roster/07-roster-manual-edit.md "Design" §3). */
export const ROSTER_VIEWS = ["staff", "role", "coverage"] as const;
export type RosterView = (typeof ROSTER_VIEWS)[number];

export const ROSTER_VIEW_LABELS: Record<RosterView, string> = {
  staff: "スタッフ別",
  role: "役割別",
  coverage: "充足状況",
};
