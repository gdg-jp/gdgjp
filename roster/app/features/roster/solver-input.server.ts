import { listApplicationsForEvent } from "~/features/applications/applications.server";
import { listAvailabilityForApplication } from "~/features/applications/availability.server";
import { listSkillsForApplication } from "~/features/applications/skills.server";
import { listDemandsForEvent } from "~/features/demand/demand.server";
import type { EventRecord } from "~/features/events/events.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { listEventRoleIds, listRoles, listTracks } from "~/features/schedule/tracks.server";
import {
  type Availability,
  type Level,
  type Pref,
  type SolverApplication,
  type SolverInput,
  demandKey,
} from "~/features/solver/types";
import { readAssignmentsMap } from "./assignment-reads.server";

/**
 * Assembles a `SolverInput` from D1 rows (docs/roster/07-roster-manual-edit.md
 * "Design" §2: "組み立ては app/features/roster/solver-input.server.ts に切り出す
 * ...この関数は「D1 の行 → SolverInput」の変換だけを行い、テストできる形にする").
 * This is the ONLY place D1 rows are mapped onto the solver's plain types —
 * `solve()` / `evaluate()` / `hardViolations()` / `suggestFor()` never see a
 * `D1Database` (ADR-004). Reuses `~/features/demand`, `~/features/applications`,
 * and `~/features/schedule`'s existing reads verbatim, per the stage doc's
 * "再利用する既存実装" — no new query is written against `time_slots`,
 * `tracks`, `roles`, `event_roles`, `demands`, `applications`,
 * `application_skills`, or `availabilities`.
 *
 * DETERMINISM is this function's hardest requirement
 * (docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト", 1st
 * bullet): calling this twice against unchanged D1 data must return an
 * identically-ordered result, because `solve()`'s greedy fill breaks cost
 * ties by iteration order (`~/features/solver/solve.ts`'s `fillCell` picks
 * the FIRST strictly-lower-cost candidate scanning `input.applications` in
 * array order; `~/features/solver/scarcity.ts`'s `orderDemandCells` stable-
 * sorts `input.demands`' Map-iteration order, tie-broken only by slot `idx` —
 * two different (track, role) cells in the same slot can still tie on both
 * scarcity and idx). Two places here need an explicit, D1-row-order-
 * independent sort for that reason, neither of which the upstream read
 * functions promise on their own:
 *
 *  - `applications` is re-sorted by `id` — `listApplicationsForEvent`'s own
 *    `ORDER BY created_at` exists for the staff table's display, not as a
 *    determinism contract this feature can lean on (two rows created in the
 *    same request could tie on `created_at`). Sorting by the always-unique
 *    `id` after the fetch removes that dependency entirely.
 *  - `demands` is built by inserting entries in `demandKey`-sorted order, so
 *    the Map's iteration order — and therefore `orderDemandCells`' scan
 *    order — is independent of whatever order D1 happens to return
 *    `listDemandsForEvent`'s rows in.
 *
 * `listTimeSlots` / `listTracks` / `listRoles` already carry their own
 * `ORDER BY idx` / `ORDER BY sort_order` (Stage 02/03), which is sufficient
 * here because nothing in `solve.ts` iterates `input.slots` / `input.tracks`
 * / `input.roles` directly for tie-breaking — every lookup goes through Maps
 * `solve.ts` builds internally, keyed by id.
 *
 * Withdrawn applicants are filtered out ENTIRELY here, not merely flagged
 * (docs/roster/07-roster-manual-edit.md "回帰として固定すべきテスト": "辞退者が
 * SolverInput に含まれない — 含まれると辞退した人がシフトに入る"). This is
 * belt-and-suspenders on top of `hardViolations`' own withdrawn check inside
 * the solver — a caller must not depend on that check alone.
 *
 * An explicitly supplied seed overrides the selected sheet's seed; callers
 * that omit it use the selected sheet's seed.
 */
export async function buildSolverInput(
  db: D1Database,
  event: Pick<EventRecord, "id">,
  seed?: number,
  rosterSheetId?: string,
): Promise<SolverInput> {
  const sheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, event.id)
      : await getRosterSheet(db, event.id, rosterSheetId);
  if (!sheet) throw new Error("Roster sheet not found for this event.");
  const [timeSlots, tracks, eventRoleIds, allRoles, demandRows, applications] = await Promise.all([
    listTimeSlots(db, event.id, sheet.id),
    listTracks(db, event.id, sheet.id),
    listEventRoleIds(db, event.id, sheet.id),
    listRoles(db),
    listDemandsForEvent(db, event.id, sheet.id),
    listApplicationsForEvent(db, event.id),
  ]);

  const eventRoleIdSet = new Set(eventRoleIds);
  const roles = allRoles.filter((role) => eventRoleIdSet.has(role.id));

  const demands: SolverInput["demands"] = new Map();
  const sortedDemandRows = [...demandRows].sort((a, b) =>
    demandKey(a.timeSlotId, a.trackId, a.roleId).localeCompare(
      demandKey(b.timeSlotId, b.trackId, b.roleId),
    ),
  );
  for (const d of sortedDemandRows) {
    demands.set(demandKey(d.timeSlotId, d.trackId, d.roleId), {
      min: d.min,
      ideal: d.ideal,
      leadMin: d.leadMin,
      newMax: d.newMax,
    });
  }

  const active = applications.filter((a) => !a.withdrawn);
  const solverApplications: SolverApplication[] = await Promise.all(
    active.map(async (application): Promise<SolverApplication> => {
      const [skills, availability] = await Promise.all([
        listSkillsForApplication(db, application.id),
        listAvailabilityForApplication(db, application.id, sheet.id),
      ]);
      const skillsRecord: Record<string, { level: Level; pref: Pref }> = {};
      for (const s of skills) skillsRecord[s.roleId] = { level: s.level, pref: s.pref };
      const availabilityRecord: Record<string, Availability> = {};
      for (const a of availability) availabilityRecord[a.timeSlotId] = a.value;
      return {
        id: application.id,
        withdrawn: false, // filtered above — always false for anything that reaches here
        skills: skillsRecord,
        availability: availabilityRecord,
      };
    }),
  );
  // Promise.all preserves `active`'s order in its result array regardless of
  // resolution timing, but `active`'s order itself is only as reliable as
  // listApplicationsForEvent's ORDER BY — re-sort by the always-unique `id`
  // so this function's own output order never depends on that.
  solverApplications.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    slots: timeSlots.map((slot) => ({ id: slot.id, idx: slot.idx })),
    tracks: tracks.map((track) => ({ id: track.id })),
    roles: roles.map((role) => ({ id: role.id })),
    demands,
    applications: solverApplications,
    existingAssignments: await readAssignmentsMap(db, event.id, sheet.id),
    options: {
      noSoloNewcomer: sheet.noSoloNewcomer,
      maxConsecutive: sheet.maxConsecutive,
      seed: seed ?? sheet.seed,
    },
  };
}
