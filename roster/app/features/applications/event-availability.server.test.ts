import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { listAvailabilityForApplication, setAvailability } from "./availability.server";
import {
  listEventAvailabilityForApplication,
  setEventAvailability,
} from "./event-availability.server";

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

describe("event-wide availability", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  async function storedRows() {
    const { results } = await testDb
      .prepare(
        "SELECT time_slot_id, value FROM availabilities WHERE application_id = 'app' ORDER BY time_slot_id",
      )
      .all();
    return results;
  }

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await testDb
      .prepare(`INSERT INTO events
      (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
      VALUES ('event', 1, 'Event', '2026-11-07', '09:00', '18:00', 1, 'apply', 'view', 'now', 'now'),
             ('foreign', 1, 'Other', '2026-11-07', '09:00', '18:00', 1, 'apply2', 'view2', 'now', 'now')`)
      .run();
    await testDb
      .prepare(`INSERT INTO applications
      (id, event_id, email, name, created_at, updated_at)
      VALUES ('app', 'event', 'staff@example.com', 'Staff', 'now', 'now'),
             ('other_app', 'event', 'other@example.com', 'Other', 'now', 'now')`)
      .run();
    await testDb
      .prepare(`INSERT INTO roster_sheets
      (id, event_id, name, date, start_time, end_time, seed, sort_order, created_at, updated_at, deleted_at)
      VALUES ('party', 'event', 'Party', '2026-11-07', '18:00', '19:00', 1, -1, 'now', 'now', NULL),
             ('archive', 'event', 'Archived', '2026-11-07', '19:00', '20:00', 1, 2, 'now', 'now', 'deleted')`)
      .run();
    await testDb
      .prepare(`INSERT INTO time_slots
      (id, event_id, idx, start_time, end_time, roster_sheet_id)
      VALUES ('main_1', 'event', 1, '10:00', '11:00', 'default:event'),
             ('main_0', 'event', 0, '09:00', '10:00', 'default:event'),
             ('party_slot', 'event', 0, '18:00', '19:00', 'party'),
             ('archived_slot', 'event', 0, '19:00', '20:00', 'archive'),
             ('foreign_slot', 'foreign', 0, '09:00', '10:00', 'default:foreign')`)
      .run();
    await testDb
      .prepare(`INSERT INTO availabilities VALUES
      ('app', 'main_1', 'd'), ('app', 'main_0', 'o'), ('app', 'party_slot', 'x'),
      ('app', 'archived_slot', 'd'), ('other_app', 'main_0', 'o')`)
      .run();
  });

  it("reads only live sheets in sheet order then slot order", async () => {
    expect(await listEventAvailabilityForApplication(db, "app")).toEqual([
      { applicationId: "app", timeSlotId: "party_slot", value: "x" },
      { applicationId: "app", timeSlotId: "main_0", value: "o" },
      { applicationId: "app", timeSlotId: "main_1", value: "d" },
    ]);
  });

  it("replaces both live sheets, preserves archived rows and other applications", async () => {
    await setEventAvailability(db, "app", [
      { timeSlotId: "party_slot", value: "o" },
      { timeSlotId: "main_0", value: "d" },
      { timeSlotId: "main_1", value: "x" },
    ]);
    expect(await storedRows()).toEqual([
      { time_slot_id: "archived_slot", value: "d" },
      { time_slot_id: "main_0", value: "d" },
      { time_slot_id: "main_1", value: "x" },
      { time_slot_id: "party_slot", value: "o" },
    ]);
    expect(await listAvailabilityForApplication(db, "other_app")).toEqual([
      { applicationId: "other_app", timeSlotId: "main_0", value: "o" },
    ]);
    await setAvailability(db, "app", [{ timeSlotId: "main_0", value: "d" }]);
    expect(await listAvailabilityForApplication(db, "app", "party")).toEqual([
      { applicationId: "app", timeSlotId: "party_slot", value: "o" },
    ]);
  });

  it("rejects partial and empty grids without changing any availability", async () => {
    const before = await storedRows();
    await expect(
      setEventAvailability(db, "app", [
        { timeSlotId: "main_0", value: "x" },
        { timeSlotId: "main_1", value: "x" },
      ]),
    ).rejects.toThrow("exactly the current live event time slots");
    expect(await storedRows()).toEqual(before);
    await expect(setEventAvailability(db, "app", [])).rejects.toThrow(
      "exactly the current live event time slots",
    );
    expect(await storedRows()).toEqual(before);
  });

  it("accepts an empty grid only when no live slots remain, preserving archived rows", async () => {
    await testDb
      .prepare("DELETE FROM time_slots WHERE roster_sheet_id IN ('default:event', 'party')")
      .run();
    await setEventAvailability(db, "app", []);
    expect(await listEventAvailabilityForApplication(db, "app")).toEqual([]);
    expect(await storedRows()).toEqual([{ time_slot_id: "archived_slot", value: "d" }]);
  });

  it.each(["foreign_slot", "archived_slot", "missing_slot"])(
    "rejects %s before changing either live sheet",
    async (timeSlotId) => {
      const before = await storedRows();
      await expect(
        setEventAvailability(db, "app", [
          { timeSlotId: "main_0", value: "x" },
          { timeSlotId: "main_1", value: "d" },
          { timeSlotId: "party_slot", value: "o" },
          { timeSlotId, value: "o" },
        ]),
      ).rejects.toThrow("exactly the current live event time slots");
      expect(await storedRows()).toEqual(before);
    },
  );

  it("rejects duplicate slots before changing existing rows", async () => {
    const before = await storedRows();
    await expect(
      setEventAvailability(db, "app", [
        { timeSlotId: "main_0", value: "o" },
        { timeSlotId: "main_0", value: "x" },
      ]),
    ).rejects.toThrow("unique slots");
    expect(await storedRows()).toEqual(before);
  });

  it.each([
    "UPDATE roster_sheets SET deleted_at = 'raced' WHERE id = 'party'",
    "DELETE FROM time_slots WHERE id = 'party_slot'",
    "UPDATE events SET deleted_at = 'raced' WHERE id = 'event'",
    `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
     VALUES ('new_slot', 'event', 2, '11:00', '12:00', 'default:event')`,
    "UPDATE roster_sheets SET deleted_at = NULL WHERE id = 'archive'",
  ])("guards against a scope change between validation and batch: %s", async (mutation) => {
    let afterRace: Awaited<ReturnType<typeof storedRows>> = [];
    const racedDb = asD1({
      prepare: (sql) => testDb.prepare(sql),
      async batch(statements) {
        await testDb.prepare(mutation).run();
        afterRace = await storedRows();
        return testDb.batch(statements);
      },
    });
    await expect(
      setEventAvailability(racedDb, "app", [
        { timeSlotId: "main_0", value: "x" },
        { timeSlotId: "main_1", value: "d" },
        { timeSlotId: "party_slot", value: "o" },
      ]),
    ).rejects.toThrow();
    expect(await storedRows()).toEqual(afterRace);
  });

  it("rejects missing applications and deleted events for reads and writes", async () => {
    await expect(listEventAvailabilityForApplication(db, "missing")).rejects.toThrow(
      "Application not found",
    );
    await expect(setEventAvailability(db, "missing", [])).rejects.toThrow("Application not found");
    const before = await storedRows();
    await testDb.prepare("UPDATE events SET deleted_at = 'deleted' WHERE id = 'event'").run();
    await expect(listEventAvailabilityForApplication(db, "app")).rejects.toThrow(
      "Application not found",
    );
    await expect(setEventAvailability(db, "app", [])).rejects.toThrow("Application not found");
    expect(await storedRows()).toEqual(before);
  });
});
