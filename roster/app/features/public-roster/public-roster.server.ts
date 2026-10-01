import { listApplicationsForEvent } from "~/features/applications/applications.server";
import type { EventRecord } from "~/features/events/events.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { readAssignments } from "~/features/roster/roster.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { listEventRoleIds, listRoles, listTracks } from "~/features/schedule/tracks.server";
import type { PublicEventSummary, PublicRosterView, PublicStaff } from "./types";

/**
 * Assembles `/r/:viewToken`'s entire data surface (docs/roster/09-share-
 * public-views.md "Design" §3) — the single most security-sensitive
 * function in this stage, per the stage's own framing. Two rules this file
 * exists to enforce structurally, not just by convention:
 *
 * 1. **Sheet visibility gates ASSEMBLY, not just the rendered output.** When
 *    the selected sheet isn't `published`, this returns before a single query touches
 *    `applications`/`assignments` — an unpublished sheet's staff/assignment
 *    rows never even get read, let alone serialized into the loader's
 *    return value (docs/roster/09-share-public-views.md "制約": "データ自体
 *    を返してはならない。返していると...RR の hydration データから読める").
 *    `public-roster.server.test.ts` asserts this by spying on the D1 calls
 *    actually issued, not merely on the returned shape.
 * 2. **The published branch builds `PublicRosterData` by hand, field by
 *    field** — never spreads a D1 row or an existing domain record — so a
 *    later field added to `ApplicationRecord`/`AssignmentRecord` (email,
 *    contact, a new PII column, an experience level) cannot silently ride
 *    along. Withdrawn applicants are dropped entirely, and any residual
 *    assignment row belonging to one is dropped with them (unlike the
 *    owner-only `StaffGrid`, which deliberately keeps a withdrawn person's
 *    stale assignment visible as a violation — that owner-side nuance has no
 *    public equivalent, docs/roster/09-share-public-views.md "前提として
 *    確認済みの事実").
 */
export async function buildPublicRosterData(
  db: D1Database,
  event: EventRecord,
  rosterSheetId?: string,
): Promise<PublicRosterView> {
  const eventSummary: PublicEventSummary = {
    name: event.name,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    hasParty: event.hasParty,
  };

  // Public roster views always describe one live, explicitly published
  // sheet. Event-only callers retain compatibility by selecting the default
  // sheet, whose visibility is synchronized with the event status by the
  // compatibility trigger. Other sheets have independent publication state.
  const rosterSheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, event.id)
      : await getRosterSheet(db, event.id, rosterSheetId);
  if (!rosterSheet || rosterSheet.visibility !== "published") {
    return { published: false, event: eventSummary };
  }

  const [timeSlots, tracks, eventRoleIds, allRoles, applications, assignments] = await Promise.all([
    listTimeSlots(db, event.id, rosterSheet.id),
    listTracks(db, event.id, rosterSheet.id),
    listEventRoleIds(db, event.id, rosterSheet.id),
    listRoles(db),
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
      event: eventSummary,
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
