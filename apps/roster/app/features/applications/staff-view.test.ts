import { describe, expect, it } from "vitest";
import { type StaffDetailInput, buildStaffRows, toStaffDrawerDetail } from "./staff-view";
import type { ApplicationRecord, ApplicationSkillRecord, AvailabilityRecord } from "./types";

function application(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: "app_1",
    eventId: "evt_1",
    userId: "user_1",
    email: "a@example.com",
    name: "山田太郎",
    contact: null,
    party: "undecided",
    note: null,
    withdrawn: false,
    updatedBy: "self",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function skill(overrides: Partial<ApplicationSkillRecord> = {}): ApplicationSkillRecord {
  return { applicationId: "app_1", roleId: "stream", level: "exp", pref: 2, ...overrides };
}

function availability(overrides: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return { applicationId: "app_1", timeSlotId: "slot_1", value: "o", ...overrides };
}

const ROLES = [
  { id: "stream", name: "配信" },
  { id: "reception", name: "受付" },
];

describe("buildStaffRows", () => {
  it("maps role ids to role names for the role tags", () => {
    const details: StaffDetailInput[] = [
      { application: application(), skills: [skill()], availability: [] },
    ];
    const rows = buildStaffRows(details, ROLES, []);
    expect(rows[0].roles).toEqual([{ roleId: "stream", roleName: "配信", level: "exp", pref: 2 }]);
  });

  it("falls back to the raw roleId when the role isn't found (defensive, shouldn't happen in practice)", () => {
    const details: StaffDetailInput[] = [
      { application: application(), skills: [skill({ roleId: "unknown" })], availability: [] },
    ];
    const rows = buildStaffRows(details, ROLES, []);
    expect(rows[0].roles[0].roleName).toBe("unknown");
  });

  it("counts o and d availability separately, across the given time slot ids only", () => {
    const details: StaffDetailInput[] = [
      {
        application: application(),
        skills: [],
        availability: [
          availability({ timeSlotId: "slot_1", value: "o" }),
          availability({ timeSlotId: "slot_2", value: "o" }),
          availability({ timeSlotId: "slot_3", value: "d" }),
          availability({ timeSlotId: "slot_4", value: "x" }),
          // A stale row for a slot the event no longer has — must not count.
          availability({ timeSlotId: "slot_stale", value: "o" }),
        ],
      },
    ];
    const rows = buildStaffRows(details, ROLES, ["slot_1", "slot_2", "slot_3", "slot_4"]);
    expect(rows[0].availableCount).toBe(2);
    expect(rows[0].softAvailableCount).toBe(1);
  });

  it("passes through withdrawn, party, updatedBy, and updatedAt as-is", () => {
    const details: StaffDetailInput[] = [
      {
        application: application({ withdrawn: true, party: "yes", updatedBy: "owner" }),
        skills: [],
        availability: [],
      },
    ];
    const rows = buildStaffRows(details, ROLES, []);
    expect(rows[0]).toMatchObject({
      withdrawn: true,
      party: "yes",
      updatedBy: "owner",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("returns one row per applicant, preserving input order", () => {
    const details: StaffDetailInput[] = [
      { application: application({ id: "app_1", name: "A" }), skills: [], availability: [] },
      { application: application({ id: "app_2", name: "B" }), skills: [], availability: [] },
    ];
    const rows = buildStaffRows(details, ROLES, []);
    expect(rows.map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("toStaffDrawerDetail", () => {
  it("builds the drawer's editable snapshot from the same detail input", () => {
    const detail: StaffDetailInput = {
      application: application({ withdrawn: true }),
      skills: [skill({ level: "lead", pref: 1 })],
      availability: [availability({ value: "d" })],
    };
    expect(toStaffDrawerDetail(detail)).toEqual({
      applicationId: "app_1",
      name: "山田太郎",
      withdrawn: true,
      skills: [{ roleId: "stream", level: "lead", pref: 1 }],
      availability: [{ timeSlotId: "slot_1", value: "d" }],
    });
  });
});
