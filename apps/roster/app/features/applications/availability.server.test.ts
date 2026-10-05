import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  listAvailabilityForApplication,
  setAvailability,
  toAvailability,
} from "./availability.server";

const MIGRATIONS = [
  fileURLToPath(new URL("../../../migrations/0001_init.sql", import.meta.url)),
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

const APPLICATION_ID = "app_1";
const SLOT_1 = "slot_1";
const SLOT_2 = "slot_2";
const OTHER_SHEET = "sheet_other";
const OTHER_SLOT = "slot_other";

async function seedApplicationAndSlots(testDb: TestD1Database) {
  const now = new Date().toISOString();
  await testDb
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'apply-tok', 'view-tok', ?, ?)`,
    )
    .bind(now, now)
    .run();
  await testDb
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, created_at, updated_at)
       VALUES (?, 'evt_1', 'user_1', 'a@example.com', 'A', ?, ?)`,
    )
    .bind(APPLICATION_ID, now, now)
    .run();
  await testDb
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, 'evt_1', 0, '09:00', '10:00')",
    )
    .bind(SLOT_1)
    .run();
  await testDb
    .prepare(
      "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, 'evt_1', 1, '10:00', '11:00')",
    )
    .bind(SLOT_2)
    .run();

  await testDb
    .prepare(
      `INSERT INTO roster_sheets
       (id, event_id, name, date, start_time, end_time, seed, created_at, updated_at)
       VALUES (?, 'evt_1', 'Additional', '2026-11-07', '13:00', '14:00', 2, ?, ?)`,
    )
    .bind(OTHER_SHEET, now, now)
    .run();
  await testDb
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES (?, 'evt_1', 0, '13:00', '14:00', ?)`,
    )
    .bind(OTHER_SLOT, OTHER_SHEET)
    .run();
}

describe("toAvailability", () => {
  it("maps snake_case columns to camelCase", () => {
    expect(toAvailability({ application_id: "app_1", time_slot_id: "slot_1", value: "o" })).toEqual(
      {
        applicationId: "app_1",
        timeSlotId: "slot_1",
        value: "o",
      },
    );
  });
});

describe("setAvailability / listAvailabilityForApplication (real SQLite)", () => {
  let testDb: TestD1Database;
  let db: D1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    db = asD1(testDb);
    await seedApplicationAndSlots(testDb);
  });

  it("stores one row per time slot", async () => {
    await setAvailability(db, APPLICATION_ID, [
      { timeSlotId: SLOT_1, value: "o" },
      { timeSlotId: SLOT_2, value: "x" },
    ]);
    const rows = await listAvailabilityForApplication(db, APPLICATION_ID);
    expect(rows).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_1, value: "o" },
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_2, value: "x" },
    ]);
  });

  it("stores a grid larger than SQLite's compound-SELECT term limit", async () => {
    const slotIds = Array.from({ length: 600 }, (_, i) => `slot_bulk_${i}`);
    for (const [i, id] of slotIds.entries()) {
      await testDb
        .prepare(
          "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, 'evt_1', ?, '09:00', '10:00')",
        )
        .bind(id, i + 2)
        .run();
    }
    await setAvailability(
      db,
      APPLICATION_ID,
      slotIds.map((timeSlotId) => ({ timeSlotId, value: "o" as const })),
    );
    const rows = await listAvailabilityForApplication(db, APPLICATION_ID);
    expect(rows).toHaveLength(600);
  });

  it("wholesale-replaces the grid on a second call", async () => {
    await setAvailability(db, APPLICATION_ID, [{ timeSlotId: SLOT_1, value: "o" }]);
    await setAvailability(db, APPLICATION_ID, [
      { timeSlotId: SLOT_1, value: "x" },
      { timeSlotId: SLOT_2, value: "d" },
    ]);
    const rows = await listAvailabilityForApplication(db, APPLICATION_ID);
    expect(rows).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_1, value: "x" },
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_2, value: "d" },
    ]);
  });

  it("cascades deletes when the time slot is removed (ON DELETE CASCADE)", async () => {
    await setAvailability(db, APPLICATION_ID, [
      { timeSlotId: SLOT_1, value: "o" },
      { timeSlotId: SLOT_2, value: "o" },
    ]);
    await testDb.prepare("DELETE FROM time_slots WHERE id = ?").bind(SLOT_1).run();
    const rows = await listAvailabilityForApplication(db, APPLICATION_ID);
    expect(rows).toEqual([{ applicationId: APPLICATION_ID, timeSlotId: SLOT_2, value: "o" }]);
  });

  it("scopes reads and replacement to the selected sheet, preserving sibling availability", async () => {
    await setAvailability(db, APPLICATION_ID, [{ timeSlotId: SLOT_1, value: "o" }]);
    await setAvailability(
      db,
      APPLICATION_ID,
      [{ timeSlotId: OTHER_SLOT, value: "d" }],
      OTHER_SHEET,
    );

    expect(await listAvailabilityForApplication(db, APPLICATION_ID)).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_1, value: "o" },
    ]);
    expect(await listAvailabilityForApplication(db, APPLICATION_ID, OTHER_SHEET)).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: OTHER_SLOT, value: "d" },
    ]);

    await setAvailability(db, APPLICATION_ID, [{ timeSlotId: SLOT_2, value: "x" }]);
    expect(await listAvailabilityForApplication(db, APPLICATION_ID, OTHER_SHEET)).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: OTHER_SLOT, value: "d" },
    ]);
  });

  it("rejects a slot outside the selected sheet before changing its existing rows", async () => {
    await setAvailability(db, APPLICATION_ID, [{ timeSlotId: SLOT_1, value: "o" }]);

    await expect(
      setAvailability(db, APPLICATION_ID, [{ timeSlotId: OTHER_SLOT, value: "x" }]),
    ).rejects.toThrow("Availability time slot not found for this roster sheet.");
    expect(await listAvailabilityForApplication(db, APPLICATION_ID)).toEqual([
      { applicationId: APPLICATION_ID, timeSlotId: SLOT_1, value: "o" },
    ]);
  });

  it("fails the batch if the selected sheet is deleted after validation", async () => {
    await setAvailability(db, APPLICATION_ID, [{ timeSlotId: SLOT_1, value: "o" }]);
    const raceDb = asD1({
      prepare: (sql: string) => testDb.prepare(sql),
      async batch(statements) {
        await testDb
          .prepare("UPDATE roster_sheets SET deleted_at = 'raced-delete' WHERE id = ?")
          .bind("default:evt_1")
          .run();
        return testDb.batch(statements);
      },
    });

    await expect(
      setAvailability(raceDb, APPLICATION_ID, [{ timeSlotId: SLOT_2, value: "x" }]),
    ).rejects.toThrow();

    const { results } = await testDb
      .prepare("SELECT time_slot_id, value FROM availabilities WHERE application_id = ?")
      .bind(APPLICATION_ID)
      .all<{ time_slot_id: string; value: string }>();
    expect(results).toEqual([{ time_slot_id: SLOT_1, value: "o" }]);
  });

  it("rejects an explicit sheet from another event or a deleted sheet", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed,
          apply_token, view_token, created_at, updated_at)
         VALUES ('evt_2', 1, 'Other event', '2026-11-08', '09:00', '10:00', 1,
          'apply-tok-2', 'view-tok-2', ?, ?)`,
      )
      .bind(now, now)
      .run();
    await expect(
      listAvailabilityForApplication(db, APPLICATION_ID, "default:evt_2"),
    ).rejects.toThrow("Roster sheet not found for this application event.");

    await testDb
      .prepare("UPDATE roster_sheets SET deleted_at = 'deleted' WHERE id = ?")
      .bind(OTHER_SHEET)
      .run();
    await expect(setAvailability(db, APPLICATION_ID, [], OTHER_SHEET)).rejects.toThrow(
      "Roster sheet not found for this application event.",
    );
  });
});
