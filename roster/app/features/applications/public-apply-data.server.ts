import { listRosterSheets } from "~/features/roster-sheets/roster-sheets.server";
import { listPhases, listTimeSlots } from "~/features/schedule/schedule.server";
import { listEventRoleIds, listRoles } from "~/features/schedule/tracks.server";

export type PublicApplyTimeSlot = {
  id: string;
  start: string;
  end: string;
  phaseName: string | null;
};

export type PublicApplyRosterSheet = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  stepMin: number;
  timeSlots: PublicApplyTimeSlot[];
};

export type PublicApplyData = {
  rosterSheets: PublicApplyRosterSheet[];
  roles: { id: string; name: string }[];
};

/**
 * Builds the public registration schedule for one already-authorized event.
 * Applications, skills, availability, and party RSVP stay event-owned; only
 * the selectable roles and slots are composed from each live roster sheet.
 */
export async function getPublicApplyData(
  db: D1Database,
  eventId: string,
): Promise<PublicApplyData> {
  const sheets = await listRosterSheets(db, eventId);
  const [allRoles, sheetData] = await Promise.all([
    listRoles(db),
    Promise.all(
      sheets.map(async (sheet) => {
        const [phases, timeSlots, roleIds] = await Promise.all([
          listPhases(db, eventId, sheet.id),
          listTimeSlots(db, eventId, sheet.id),
          listEventRoleIds(db, eventId, sheet.id),
        ]);
        const phaseNameById = new Map(phases.map((phase) => [phase.id, phase.name]));
        return {
          sheet,
          roleIds,
          timeSlots: timeSlots.map((slot) => ({
            id: slot.id,
            start: slot.start,
            end: slot.end,
            phaseName: slot.phaseId ? (phaseNameById.get(slot.phaseId) ?? null) : null,
          })),
        };
      }),
    ),
  ]);

  const selectedRoleIds = new Set(sheetData.flatMap(({ roleIds }) => roleIds));
  const rosterSheets = sheetData.map(({ sheet, timeSlots }) => ({
    id: sheet.id,
    name: sheet.name,
    date: sheet.date,
    startTime: sheet.startTime,
    endTime: sheet.endTime,
    stepMin: sheet.stepMin,
    timeSlots,
  }));

  return {
    rosterSheets,
    roles: allRoles
      .filter((role) => selectedRoleIds.has(role.id))
      .map((role) => ({ id: role.id, name: role.name })),
  };
}
