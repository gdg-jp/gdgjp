import { listApplicationsForEvent } from "~/features/applications/applications.server";
import { listAvailabilityForApplication } from "~/features/applications/availability.server";
import { listSkillsForApplication } from "~/features/applications/skills.server";
import { listDemandsForEvent } from "~/features/demand/demand.server";
import type { EventRecord } from "~/features/events/events.server";
import { listCrossSheetAssignmentOverlapByApplication } from "~/features/roster-sheets/cross-sheet-conflicts.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { listEventRoleIds, listRoles } from "~/features/schedule/roles.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { listTracks } from "~/features/schedule/tracks.server";
import {
  type Availability,
  type Level,
  type Pref,
  type SolverApplication,
  type SolverInput,
  demandKey,
} from "~/features/solver/types";
import { readAssignmentsMap } from "./assignment-reads.server";

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
  const [timeSlots, tracks, eventRoleIds, allRoles, demandRows, applications, crossSheetOverlaps] =
    await Promise.all([
      listTimeSlots(db, event.id, sheet.id),
      listTracks(db, event.id, sheet.id),
      listEventRoleIds(db, event.id, sheet.id),
      listRoles(db, event.id),
      listDemandsForEvent(db, event.id, sheet.id),
      listApplicationsForEvent(db, event.id),
      listCrossSheetAssignmentOverlapByApplication(db, event.id, sheet.id),
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
      const unavailableSlots = crossSheetOverlaps.get(application.id);
      for (const a of availability) {
        availabilityRecord[a.timeSlotId] = unavailableSlots?.has(a.timeSlotId) ? "x" : a.value;
      }
      for (const slotId of unavailableSlots ?? []) availabilityRecord[slotId] = "x";
      return {
        id: application.id,
        withdrawn: false,
        skills: skillsRecord,
        availability: availabilityRecord,
      };
    }),
  );
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
