import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { getPublicApplyData } from "./public-apply-data.server";

const MIGRATIONS = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
].map((name) => fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)));

async function seedEvent(db: TestD1Database, eventId: string, applyToken: string) {
  await db
    .prepare(
      `INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token,
         created_at, updated_at)
       VALUES (?, 1, ?, '2026-11-07', '09:00', '18:00', 1, ?, ?, 'now', 'now')`,
    )
    .bind(eventId, eventId, applyToken, `view_${eventId}`)
    .run();
}

async function seedSchedule(db: TestD1Database) {
  await seedEvent(db, "event_one", "apply_one");
  await seedEvent(db, "event_two", "apply_two");
  await db
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('event_one', 'reception')")
    .run();
  await db
    .prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('event_two', 'photo')")
    .run();

  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min, seed, visibility, sort_order,
         created_at, updated_at)
       VALUES
         ('sheet_workshop', 'event_one', 'ワークショップ', '2026-11-07', '12:00', '14:00', 60, 2, 'private', 5, 'now', 'now'),
         ('sheet_archived', 'event_one', 'アーカイブ済み', '2026-11-07', '14:00', '15:00', 60, 3, 'private', 6, 'now', 'now'),
         ('sheet_other_event', 'event_two', '別イベント', '2026-11-07', '15:00', '16:00', 60, 4, 'private', 1, 'now', 'now')`,
    )
    .run();
  await db
    .prepare("UPDATE roster_sheets SET deleted_at = 'archived' WHERE id = 'sheet_archived'")
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheet_roles (roster_sheet_id, role_id)
       VALUES ('sheet_workshop', 'guide'), ('sheet_archived', 'setup'),
              ('sheet_other_event', 'photo')`,
    )
    .run();

  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES
         ('default_slot_1', 'event_one', 1, '10:00', '11:00', 'default:event_one'),
         ('default_slot_0', 'event_one', 0, '09:00', '10:00', 'default:event_one'),
         ('workshop_slot_1', 'event_one', 1, '13:00', '14:00', 'sheet_workshop'),
         ('workshop_slot_0', 'event_one', 0, '12:00', '13:00', 'sheet_workshop'),
         ('archived_slot', 'event_one', 0, '14:00', '15:00', 'sheet_archived'),
         ('other_event_slot', 'event_two', 0, '15:00', '16:00', 'sheet_other_event')`,
    )
    .run();
}

describe("getPublicApplyData", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedSchedule(testDb);
  });

  it("returns active sheets with their own metadata and slots in stable order", async () => {
    const data = await getPublicApplyData(asD1(testDb), "event_one");

    expect(data.rosterSheets.map((sheet) => sheet.id)).toEqual([
      "default:event_one",
      "sheet_workshop",
    ]);
    expect(data.rosterSheets[0]).toMatchObject({
      name: "本編",
      date: "2026-11-07",
      startTime: "09:00",
      endTime: "18:00",
      timeSlots: [
        { id: "default_slot_0", start: "09:00", end: "10:00" },
        { id: "default_slot_1", start: "10:00", end: "11:00" },
      ],
    });
    expect(data.rosterSheets[1]).toMatchObject({
      id: "sheet_workshop",
      name: "ワークショップ",
      startTime: "12:00",
      endTime: "14:00",
      timeSlots: [
        { id: "workshop_slot_0", phaseName: null },
        { id: "workshop_slot_1", phaseName: null },
      ],
    });
  });

  it("excludes archived sheets, slots, and roles from the apply choices", async () => {
    const data = await getPublicApplyData(asD1(testDb), "event_one");

    expect(data.rosterSheets.some((sheet) => sheet.id === "sheet_archived")).toBe(false);
    expect(
      data.rosterSheets
        .flatMap((sheet) => sheet.timeSlots)
        .some((slot) => slot.id === "archived_slot"),
    ).toBe(false);
    expect(data.roles.map((role) => role.id)).toEqual(["reception", "guide"]);
  });

  it("unions selected roles across active sheets while keeping events isolated", async () => {
    const eventOne = await getPublicApplyData(asD1(testDb), "event_one");
    const eventTwo = await getPublicApplyData(asD1(testDb), "event_two");

    expect(eventOne.roles.map((role) => role.id)).toEqual(["reception", "guide"]);
    expect(
      eventOne.rosterSheets.flatMap((sheet) => sheet.timeSlots).map((slot) => slot.id),
    ).toEqual(["default_slot_0", "default_slot_1", "workshop_slot_0", "workshop_slot_1"]);
    expect(eventTwo.rosterSheets.map((sheet) => sheet.id)).toEqual([
      "default:event_two",
      "sheet_other_event",
    ]);
    expect(eventTwo.roles.map((role) => role.id)).toEqual(["photo"]);
    expect(
      eventTwo.rosterSheets.flatMap((sheet) => sheet.timeSlots).map((slot) => slot.id),
    ).toEqual(["other_event_slot"]);
  });
});
