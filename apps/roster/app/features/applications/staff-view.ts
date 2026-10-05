import type { StaffDrawerDetail } from "./components/StaffDrawer";
import type { StaffRoleTag, StaffRow } from "./components/StaffTable";
import type { ApplicationRecord, ApplicationSkillRecord, AvailabilityRecord } from "./types";

/**
 * Pure view-model assembly for `/e/:id/staff`'s staff list (docs/roster/05-
 * staff-supply-demand.md "Design" §2). No D1 — the route's loader gathers
 * the raw rows (reusing `~/features/supply/supply.server`'s
 * `listApplicantDetailsForEvent`, whose `ApplicantDetail` shape matches
 * `StaffDetailInput` below structurally, so this module never imports from
 * `~/features/supply` — see docs/roster/05-staff-supply-demand.md "Design"
 * §5 on why the dependency must not run that direction) and this module
 * turns them into `StaffTable`'s `StaffRow`s / `StaffDrawer`'s
 * `StaffDrawerDetail`.
 */

export type StaffDetailInput = {
  application: ApplicationRecord;
  skills: readonly ApplicationSkillRecord[];
  availability: readonly AvailabilityRecord[];
};

/** Hides skills for roles no longer present on a live sheet without mutating source rows. */
export function filterStaffSkillsToRoles(
  details: readonly StaffDetailInput[],
  liveRoleIds: readonly string[],
): StaffDetailInput[] {
  const roleIds = new Set(liveRoleIds);
  return details.map((detail) => ({
    ...detail,
    skills: detail.skills.filter((skill) => roleIds.has(skill.roleId)),
  }));
}

/**
 * One row per application for the table (docs/roster/05-staff-supply-
 * demand.md "Design" §2's column list). `availableCount`/`softAvailableCount`
 * only count entries for `timeSlotIds` — a stale availability row for a
 * time slot the event no longer has (e.g. after a grid regeneration) is
 * silently excluded rather than inflating either count.
 */
export function buildStaffRows(
  details: readonly StaffDetailInput[],
  roles: readonly { id: string; name: string }[],
  timeSlotIds: readonly string[],
): StaffRow[] {
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));
  const slotIdSet = new Set(timeSlotIds);

  return details.map(({ application, skills, availability }): StaffRow => {
    const roleTags: StaffRoleTag[] = skills.map((s) => ({
      roleId: s.roleId,
      roleName: roleNameById.get(s.roleId) ?? s.roleId,
      level: s.level,
      pref: s.pref,
    }));

    let availableCount = 0;
    let softAvailableCount = 0;
    for (const a of availability) {
      if (!slotIdSet.has(a.timeSlotId)) continue;
      if (a.value === "o") availableCount += 1;
      else if (a.value === "d") softAvailableCount += 1;
    }

    return {
      applicationId: application.id,
      name: application.name,
      withdrawn: application.withdrawn,
      roles: roleTags,
      availableCount,
      softAvailableCount,
      party: application.party,
      updatedBy: application.updatedBy,
      updatedAt: application.updatedAt,
    };
  });
}

/** The owner-correction drawer's editable snapshot of one application. */
export function toStaffDrawerDetail(detail: StaffDetailInput): StaffDrawerDetail {
  return {
    applicationId: detail.application.id,
    name: detail.application.name,
    withdrawn: detail.application.withdrawn,
    skills: detail.skills.map((s) => ({ roleId: s.roleId, level: s.level, pref: s.pref })),
    availability: detail.availability.map((a) => ({ timeSlotId: a.timeSlotId, value: a.value })),
  };
}

export function buildLiveStaffView(
  details: readonly StaffDetailInput[],
  roles: readonly { id: string; name: string }[],
  timeSlotIds: readonly string[],
) {
  const visibleDetails = filterStaffSkillsToRoles(
    details,
    roles.map((role) => role.id),
  );
  return {
    staff: buildStaffRows(visibleDetails, roles, timeSlotIds),
    staffDetails: Object.fromEntries(
      visibleDetails.map((detail) => [detail.application.id, toStaffDrawerDetail(detail)]),
    ),
  };
}
