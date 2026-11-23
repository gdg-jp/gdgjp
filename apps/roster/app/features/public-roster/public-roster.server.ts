import { listApplicationsForEvent } from "~/features/applications/applications.server";
import type { EventRecord } from "~/features/events/events.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { readAssignments } from "~/features/roster/roster.server";
import { listEventRoleIds, listRoles } from "~/features/schedule/roles.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { listTracks } from "~/features/schedule/tracks.server";
import type { PublicEventSummary, PublicRosterView, PublicStaff } from "./types";

export async function buildPublicRosterData(
  db: D1Database,
  event: EventRecord,
  rosterSheetId?: string,
): Promise<PublicRosterView> {
  const eventSummary = (sheet?: {
    name: string;
    date: string;
    startTime: string;
    endTime: string;
  }): PublicEventSummary => ({
    id: event.id,
    name: event.name,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    hasParty: event.hasParty,
    sheet: sheet ?? {
      name: "本編",
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
    },
  });

  const rosterSheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, event.id)
      : await getRosterSheet(db, event.id, rosterSheetId);
  const summary = eventSummary(
    rosterSheet
      ? {
          name: rosterSheet.name,
          date: rosterSheet.date,
          startTime: rosterSheet.startTime,
          endTime: rosterSheet.endTime,
        }
      : undefined,
  );
  if (!rosterSheet || rosterSheet.visibility !== "published") {
    return { published: false, event: summary };
  }

  const [timeSlots, tracks, eventRoleIds, allRoles, applications, assignments] = await Promise.all([
    listTimeSlots(db, event.id, rosterSheet.id),
    listTracks(db, event.id, rosterSheet.id),
    listEventRoleIds(db, event.id, rosterSheet.id),
    listRoles(db, event.id),
    listApplicationsForEvent(db, event.id),
    readAssignments(db, event.id, rosterSheet.id),
  ]);

  const roleIdSet = new Set(eventRoleIds);
  const activeApplications = applications.filter((a) => !a.withdrawn);
  const staff: PublicStaff[] = activeApplications.map((a) => ({
    id: a.id,
    name: a.name,
    party: a.party,
  }));
  const staffIds = new Set(staff.map((s) => s.id));

  return {
    published: true,
    data: {
      event: summary,
      slots: timeSlots.map((s) => ({ id: s.id, idx: s.idx, startTime: s.start, endTime: s.end })),
      tracks: tracks.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      roles: allRoles.filter((r) => roleIdSet.has(r.id)).map((r) => ({ id: r.id, name: r.name })),
      staff,
      assignments: assignments
        .filter((a) => staffIds.has(a.applicationId))
        .map((a) => ({
          applicationId: a.applicationId,
          timeSlotId: a.timeSlotId,
          trackId: a.trackId,
          roleId: a.roleId,
        })),
    },
  };
}
