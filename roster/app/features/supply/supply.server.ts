import { listApplicationsForEvent } from "~/features/applications/applications.server";
import { listAvailabilityForApplication } from "~/features/applications/availability.server";
import { listEventAvailabilityForApplication } from "~/features/applications/event-availability.server";
import { listSkillsForApplication } from "~/features/applications/skills.server";
import type {
  ApplicationRecord,
  ApplicationSkillRecord,
  AvailabilityRecord,
} from "~/features/applications/types";
import { listDemandsForEvent } from "~/features/demand/demand.server";
import { getEvent } from "~/features/events/events.server";
import {
  getDefaultRosterSheet,
  getRosterSheet,
} from "~/features/roster-sheets/roster-sheets.server";
import { listTimeSlots } from "~/features/schedule/schedule.server";
import { type SlotSupplyDemand, computeSupplyDemand, toSupplyApplicant } from "./supply";

/**
 * D1 orchestration for the supply-demand cross-check (docs/roster/05-staff-
 * supply-demand.md "Design" §1, §5). Reuses Stage 03's
 * `~/features/demand/demand.server` and Stage 04's
 * `~/features/applications/{applications,skills,availability}.server` reads
 * verbatim — every row this module needs comes from an existing exported
 * function, never a new query against those tables. The actual shortage
 * arithmetic is `./supply`'s pure `computeSupplyDemand`; this file's only
 * job is assembling its input.
 */

/** One application together with its skills and availability rows. */
export type ApplicantDetail = {
  application: ApplicationRecord;
  skills: ApplicationSkillRecord[];
  availability: AvailabilityRecord[];
};

/**
 * Event-wide staff details, including withdrawn applicants and availability
 * across all live sheets. Callers must authorize event access before reading
 * these private details. Creation order is preserved, with IDs breaking ties.
 */
export async function listEventApplicantDetails(
  db: D1Database,
  eventId: string,
): Promise<ApplicantDetail[]> {
  if (!(await getEvent(db, eventId))) throw new Error("Event not found.");
  const applications = await listApplicationsForEvent(db, eventId);
  applications.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return Promise.all(
    applications.map(async (application): Promise<ApplicantDetail> => {
      const [skills, availability] = await Promise.all([
        listSkillsForApplication(db, application.id),
        listEventAvailabilityForApplication(db, application.id),
      ]);
      return { application, skills, availability };
    }),
  );
}

/**
 * Every application for the event together with its skills and availability
 * rows (Stage 04's per-application reads, called once per applicant). Both
 * `getSupplyDemandForEvent` (below) and `/e/:id/staff`'s staff list build on
 * this single fetch — pass its result into `getSupplyDemandForEvent`'s
 * optional third argument so an owner opening that page never re-queries
 * `application_skills`/`availabilities` twice for the same applicant.
 */
export async function listApplicantDetailsForEvent(
  db: D1Database,
  eventId: string,
  rosterSheetId?: string,
): Promise<ApplicantDetail[]> {
  const sheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, eventId)
      : await getRosterSheet(db, eventId, rosterSheetId);
  if (!sheet) throw new Error("Roster sheet not found for this event.");
  const applications = await listApplicationsForEvent(db, eventId);
  return Promise.all(
    applications.map(async (application): Promise<ApplicantDetail> => {
      const [skills, availability] = await Promise.all([
        listSkillsForApplication(db, application.id),
        listAvailabilityForApplication(db, application.id, sheet.id),
      ]);
      return { application, skills, availability };
    }),
  );
}

/**
 * The event's full supply-vs-demand snapshot, one entry per time slot in
 * grid order — the entry point `/e/:id/staff`'s loader calls for
 * `SupplyDemandRow`/`ShortageSummary` (and, via `./supply`'s
 * `summarizeShortages`, the top-of-page shortage summary).
 *
 * `applicantDetails` lets a caller that already ran
 * `listApplicantDetailsForEvent` (e.g. to build the staff list in the same
 * request) pass the result straight through instead of paying for a second
 * read of the same rows; omit it to have this function load them itself.
 */
export async function getSupplyDemandForEvent(
  db: D1Database,
  eventId: string,
  applicantDetailsOrSheetId?: readonly ApplicantDetail[] | string,
  requestedSheetId?: string,
): Promise<SlotSupplyDemand[]> {
  const applicantDetails =
    typeof applicantDetailsOrSheetId === "string" ? undefined : applicantDetailsOrSheetId;
  const rosterSheetId =
    typeof applicantDetailsOrSheetId === "string" ? applicantDetailsOrSheetId : requestedSheetId;
  const sheet =
    rosterSheetId === undefined
      ? await getDefaultRosterSheet(db, eventId)
      : await getRosterSheet(db, eventId, rosterSheetId);
  if (!sheet) throw new Error("Roster sheet not found for this event.");
  const [demands, timeSlots, details] = await Promise.all([
    listDemandsForEvent(db, eventId, sheet.id),
    listTimeSlots(db, eventId, sheet.id),
    applicantDetails
      ? Promise.resolve(applicantDetails)
      : listApplicantDetailsForEvent(db, eventId, sheet.id),
  ]);

  const slotIds = new Set(timeSlots.map((slot) => slot.id));
  const applicants = details.map((d) =>
    toSupplyApplicant(
      d.application,
      d.skills,
      d.availability.filter((entry) => slotIds.has(entry.timeSlotId)),
    ),
  );

  return computeSupplyDemand(
    timeSlots.map((slot) => slot.id),
    demands,
    applicants,
  );
}
