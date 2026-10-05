import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  getSupplyDemandForEvent,
  listApplicantDetailsForEvent,
  listEventApplicantDetails,
} from "./supply.server";

const MIGRATIONS = [
  fileURLToPath(new URL("../../../migrations/0002_domain.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0003_demands.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0004_applications.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0005_assignments.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0006_revisions.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0007_roster_sheets_expand.sql", import.meta.url)),
  fileURLToPath(new URL("../../../migrations/0008_default_sheet_compat.sql", import.meta.url)),
  fileURLToPath(
    new URL("../../../migrations/0009_time_slots_sheet_uniqueness.sql", import.meta.url),
  ),
  fileURLToPath(new URL("../../../migrations/0010_revisions_sheet_sequence.sql", import.meta.url)),
];

const EVENT_ID = "evt_1";
const TRACK_ID = "track_1";
const SLOT_1 = "slot_1";
const OTHER_SHEET = "sheet:other";
const OTHER_SLOT = "slot_other";
const STREAM = "stream";

async function seedEventAndSlot(testDb: TestD1Database) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'apply-tok', 'view-tok', ?, ?)`,
    )
    .bind(EVENT_ID, now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES (?, ?, '全体', '#000', 1, 0)",
    )
    .bind(TRACK_ID, EVENT_ID)
    .run();
  await testDb
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, ?, 0, '09:00', '10:00')",
    )
    .bind(SLOT_1, EVENT_ID)
    .run();
}

async function seedDemand(
  testDb: TestD1Database,
  overrides: { min?: number; ideal?: number; leadMin?: number } = {},
  rosterSheetId = `default:${EVENT_ID}`,
  timeSlotId = SLOT_1,
  trackId = TRACK_ID,
) {
  const { min = 1, ideal = 1, leadMin = 0 } = overrides;
  await testDb
    .prepare(
      `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max, roster_sheet_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 99, ?)`,
    )
    .bind(EVENT_ID, timeSlotId, trackId, STREAM, min, ideal, leadMin, rosterSheetId)
    .run();
}

async function seedApplicant(
  testDb: TestD1Database,
  id: string,
  opts: { withdrawn?: boolean; level?: string; availability?: string } = {},
) {
  const { withdrawn = false, level = "exp", availability = "o" } = opts;
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, withdrawn, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, EVENT_ID, `user_${id}`, `${id}@example.com`, id, withdrawn ? 1 : 0, now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, ?, ?, 2)",
    )
    .bind(id, STREAM, level)
    .run();
  await testDb
    .prepare("INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, ?)")
    .bind(id, SLOT_1, availability)
    .run();
}

describe("listApplicantDetailsForEvent", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEventAndSlot(testDb);
  });

  it("returns each application with its skills and availability rows attached", async () => {
    await seedApplicant(testDb, "app_1", { level: "lead", availability: "o" });

    const details = await listApplicantDetailsForEvent(db, EVENT_ID);

    expect(details).toHaveLength(1);
    expect(details[0].application.id).toBe("app_1");
    expect(details[0].skills).toEqual([
      { applicationId: "app_1", roleId: STREAM, level: "lead", pref: 2 },
    ]);
    expect(details[0].availability).toEqual([
      { applicationId: "app_1", timeSlotId: SLOT_1, value: "o" },
    ]);
  });

  it("returns an empty list for an event with no applications", async () => {
    expect(await listApplicantDetailsForEvent(db, EVENT_ID)).toEqual([]);
  });
});

describe("listEventApplicantDetails", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEventAndSlot(testDb);
    await seedApplicant(testDb, "active", { level: "lead", availability: "x" });
    await seedApplicant(testDb, "withdrawn", { withdrawn: true });
    await testDb
      .prepare("UPDATE applications SET created_at = '2026-01-01' WHERE id = 'withdrawn'")
      .run();
    await testDb
      .prepare(`INSERT INTO events
      (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
      VALUES ('foreign', 1, 'Other', '2026-11-07', '09:00', '10:00', 1, 'other_apply', 'other_view', 'now', 'now')`)
      .run();
    await testDb
      .prepare(`INSERT INTO applications
      (id, event_id, email, name, created_at, updated_at)
      VALUES ('foreign_app', 'foreign', 'other@example.com', 'Other', 'now', 'now')`)
      .run();
    await testDb
      .prepare(`INSERT INTO roster_sheets
      (id, event_id, name, date, start_time, end_time, seed, sort_order, created_at, updated_at, deleted_at)
      VALUES ('party', 'evt_1', 'Party', '2026-11-07', '18:00', '19:00', 1, 1, 'now', 'now', NULL),
             ('archived', 'evt_1', 'Archived', '2026-11-07', '19:00', '20:00', 1, 2, 'now', 'now', 'deleted')`)
      .run();
    await testDb
      .prepare(`INSERT INTO time_slots
      (id, event_id, idx, start_time, end_time, roster_sheet_id)
      VALUES ('party_slot', 'evt_1', 0, '18:00', '19:00', 'party'),
             ('archived_slot', 'evt_1', 0, '19:00', '20:00', 'archived'),
             ('foreign_slot', 'foreign', 0, '09:00', '10:00', 'default:foreign')`)
      .run();
    await testDb
      .prepare(`INSERT INTO availabilities VALUES
      ('active', 'party_slot', 'o'), ('withdrawn', 'party_slot', 'd'),
      ('active', 'archived_slot', 'o'), ('active', 'foreign_slot', 'o'),
      ('foreign_app', 'foreign_slot', 'o')`)
      .run();
  });

  it("aggregates live-sheet availability and event-level skills in application order, retaining withdrawn staff", async () => {
    const details = await listEventApplicantDetails(db, EVENT_ID);
    expect(details.map(({ application }) => application.id)).toEqual(["withdrawn", "active"]);
    expect(details[0].application.withdrawn).toBe(true);
    expect(details[1].skills).toEqual([
      { applicationId: "active", roleId: STREAM, level: "lead", pref: 2 },
    ]);
    expect(details[0].availability).toEqual([
      { applicationId: "withdrawn", timeSlotId: SLOT_1, value: "o" },
      { applicationId: "withdrawn", timeSlotId: "party_slot", value: "d" },
    ]);
    expect(details[1].availability).toEqual([
      { applicationId: "active", timeSlotId: SLOT_1, value: "x" },
      { applicationId: "active", timeSlotId: "party_slot", value: "o" },
    ]);
    const foreign = await listEventApplicantDetails(db, "foreign");
    expect(foreign.map(({ application }) => application.id)).toEqual(["foreign_app"]);
    expect(foreign[0].availability).toEqual([
      { applicationId: "foreign_app", timeSlotId: "foreign_slot", value: "o" },
    ]);
    expect((await listApplicantDetailsForEvent(db, EVENT_ID))[1].availability).toEqual([
      { applicationId: "active", timeSlotId: SLOT_1, value: "x" },
    ]);
  });

  it("can supply either sheet from aggregate details without mixing slots or counting withdrawn staff", async () => {
    await testDb
      .prepare(`INSERT INTO tracks
      (id, event_id, name, color, shared, sort_order, roster_sheet_id)
      VALUES ('party_track', 'evt_1', 'Party', '#fff', 0, 0, 'party')`)
      .run();
    await seedDemand(testDb);
    await seedDemand(testDb, {}, "party", "party_slot", "party_track");
    const details = await listEventApplicantDetails(db, EVENT_ID);
    expect(await getSupplyDemandForEvent(db, EVENT_ID, details, `default:${EVENT_ID}`)).toEqual([
      {
        timeSlotId: SLOT_1,
        need: 1,
        available: 0,
        tight: [{ roleId: STREAM, kind: "head", lack: 1 }],
      },
    ]);
    expect(await getSupplyDemandForEvent(db, EVENT_ID, details, "party")).toEqual([
      { timeSlotId: "party_slot", need: 1, available: 1, tight: [] },
    ]);
  });

  it("breaks identical creation timestamps by application ID regardless of insertion order", async () => {
    await seedApplicant(testDb, "aaa");
    await testDb
      .prepare("UPDATE applications SET created_at = '2026-01-01' WHERE event_id = 'evt_1'")
      .run();
    const details = await listEventApplicantDetails(db, EVENT_ID);
    expect(details.map(({ application }) => application.id)).toEqual([
      "aaa",
      "active",
      "withdrawn",
    ]);
  });

  it("returns empty details for a live event without applications and rejects deleted or unknown events", async () => {
    await testDb.prepare("DELETE FROM applications WHERE event_id = 'evt_1'").run();
    expect(await listEventApplicantDetails(db, EVENT_ID)).toEqual([]);
    await testDb.prepare("UPDATE events SET deleted_at = 'deleted' WHERE id = 'foreign'").run();
    await expect(listEventApplicantDetails(db, "foreign")).rejects.toThrow("Event not found");
    await expect(listEventApplicantDetails(db, "missing")).rejects.toThrow("Event not found");
  });
});

describe("getSupplyDemandForEvent (real SQLite, migrated schema)", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedEventAndSlot(testDb);
  });

  /**
   * The stage's money test, exercised end-to-end through real D1 rows: two
   * `exp`-level (not `lead`) applicants fully cover headcount, but the slot
   * still needs to surface a lead shortage (docs/roster/05-staff-supply-
   * demand.md "回帰として固定すべきテスト").
   */
  it("surfaces a lead shortage when headcount is met but nobody is lead-level", async () => {
    await seedDemand(testDb, { min: 2, leadMin: 1 });
    await seedApplicant(testDb, "app_1", { level: "exp" });
    await seedApplicant(testDb, "app_2", { level: "exp" });

    const result = await getSupplyDemandForEvent(db, EVENT_ID);

    expect(result).toEqual([
      {
        timeSlotId: SLOT_1,
        need: 2,
        available: 2,
        tight: [{ roleId: STREAM, kind: "lead", lack: 1 }],
      },
    ]);
  });

  it("excludes a withdrawn applicant from both available and the role's candidate count", async () => {
    await seedDemand(testDb, { min: 1, leadMin: 0 });
    await seedApplicant(testDb, "app_1", { withdrawn: true });

    const result = await getSupplyDemandForEvent(db, EVENT_ID);

    expect(result).toEqual([
      {
        timeSlotId: SLOT_1,
        need: 1,
        available: 0,
        tight: [{ roleId: STREAM, kind: "head", lack: 1 }],
      },
    ]);
  });

  it("reuses a pre-fetched applicantDetails list instead of re-querying application rows", async () => {
    await seedDemand(testDb, { min: 1, leadMin: 0 });
    await seedApplicant(testDb, "app_1", { level: "lead" });

    const details = await listApplicantDetailsForEvent(db, EVENT_ID);
    // Mutate the passed-in array's data to prove it's actually used, not
    // silently re-fetched: an app not in D1 at all must still show up.
    details.push({
      application: {
        id: "phantom",
        eventId: EVENT_ID,
        userId: null,
        email: "phantom@example.com",
        name: "Phantom",
        contact: null,
        party: "undecided",
        note: null,
        withdrawn: false,
        updatedBy: "owner",
        createdAt: "",
        updatedAt: "",
      },
      skills: [{ applicationId: "phantom", roleId: STREAM, level: "lead", pref: 2 }],
      availability: [{ applicationId: "phantom", timeSlotId: SLOT_1, value: "o" }],
    });

    const result = await getSupplyDemandForEvent(db, EVENT_ID, details);

    expect(result[0].available).toBe(2);
  });

  it("returns need = 0 and no tight entries for a slot with no demand at all", async () => {
    const result = await getSupplyDemandForEvent(db, EVENT_ID);
    expect(result).toEqual([{ timeSlotId: SLOT_1, need: 0, available: 0, tight: [] }]);
  });

  it("keeps demand and availability scoped to the selected sheet, even with cross-sheet prefetched details", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO roster_sheets (id, event_id, name, date, start_time, end_time, step_min,
           no_solo_newcomer, max_consecutive, seed, visibility, sort_order, created_at, updated_at)
         VALUES (?, ?, '別枠', '2026-11-08', '09:00', '10:00', 60, 0, 2, 99, 'private', 1, ?, ?)`,
      )
      .bind(OTHER_SHEET, EVENT_ID, now, now)
      .run();
    await testDb
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES (?, ?, 0, '09:00', '10:00', ?)`,
      )
      .bind(OTHER_SLOT, EVENT_ID, OTHER_SHEET)
      .run();
    await testDb
      .prepare(
        `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
         VALUES ('track_other', ?, '別トラック', '#fff', 0, 0, ?)`,
      )
      .bind(EVENT_ID, OTHER_SHEET)
      .run();
    await seedDemand(testDb, { min: 1, leadMin: 0 }, OTHER_SHEET, OTHER_SLOT, "track_other");
    await seedApplicant(testDb, "app_1", { level: "lead", availability: "x" });
    await testDb
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, 'o')",
      )
      .bind("app_1", OTHER_SLOT)
      .run();

    const details = await listApplicantDetailsForEvent(db, EVENT_ID);
    const selectedDetails = await listApplicantDetailsForEvent(db, EVENT_ID, OTHER_SHEET);
    expect(details[0].availability).toEqual([
      { applicationId: "app_1", timeSlotId: SLOT_1, value: "x" },
    ]);
    expect(selectedDetails[0].availability).toEqual([
      { applicationId: "app_1", timeSlotId: OTHER_SLOT, value: "o" },
    ]);
    expect(await getSupplyDemandForEvent(db, EVENT_ID, selectedDetails, OTHER_SHEET)).toEqual([
      { timeSlotId: OTHER_SLOT, need: 1, available: 1, tight: [] },
    ]);
    expect(await getSupplyDemandForEvent(db, EVENT_ID, details, OTHER_SHEET)).toEqual([
      {
        timeSlotId: OTHER_SLOT,
        need: 1,
        available: 0,
        tight: [{ roleId: STREAM, kind: "head", lack: 1 }],
      },
    ]);
  });

  it("rejects a sheet from another event or a missing live default", async () => {
    await expect(listApplicantDetailsForEvent(db, EVENT_ID, "sheet:missing")).rejects.toThrow(
      "Roster sheet not found",
    );
    await expect(getSupplyDemandForEvent(db, "evt_missing")).rejects.toThrow(
      "Roster sheet not found",
    );
  });
});
