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

export type ApplicantDetail = {
  application: ApplicationRecord;
  skills: ApplicationSkillRecord[];
  availability: AvailabilityRecord[];
};

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
