import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  createPhase,
  deletePhase,
  listPhases,
  listTimeSlots,
  regenerateTimeSlots,
  toPhase,
  toTimeSlot,
} from "./schedule.server";

const migrations = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
].map((name) => fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)));

async function makeDb() {
  const db = asD1(createTestD1(migrations));
  await db
    .prepare(
      `INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, step_min, seed,
         apply_token, view_token, created_at, updated_at)
       VALUES ('evt', 1, 'Event', '2026-11-07', '09:00', '11:00', 60, 1,
         'apply', 'view', 'created', 'updated')`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, step_min,
         no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
         created_at, updated_at)
       SELECT 'sheet:other', event_id, 'Other', date, start_time, end_time, step_min,
         no_solo_newcomer, max_consecutive, seed, visibility, 1, created_at, updated_at
       FROM roster_sheets WHERE id = 'default:evt'`,
    )
    .run();
  return db;
}

describe("toPhase", () => {
  it("maps snake_case columns to camelCase", () => {
    expect(
      toPhase({
        id: "phase_1",
        event_id: "evt_1",
        name: "開場前",
        from_time: "09:00",
        to_time: "10:00",
        sort_order: 0,
      }),
    ).toEqual({
      id: "phase_1",
      eventId: "evt_1",
      name: "開場前",
      from: "09:00",
      to: "10:00",
      sortOrder: 0,
    });
  });
});

describe("toTimeSlot", () => {
  it("maps snake_case columns to camelCase, passing through a null phase_id", () => {
    expect(
      toTimeSlot({
        id: "slot_1",
        event_id: "evt_1",
        idx: 3,
        start_time: "12:00",
        end_time: "13:00",
        phase_id: null,
      }),
    ).toEqual({
      id: "slot_1",
      eventId: "evt_1",
      idx: 3,
      start: "12:00",
      end: "13:00",
      phaseId: null,
    });
  });

  it("passes through a non-null phase_id", () => {
    const slot = toTimeSlot({
      id: "slot_2",
      event_id: "evt_1",
      idx: 0,
      start_time: "09:00",
      end_time: "10:00",
      phase_id: "phase_1",
    });
    expect(slot.phaseId).toBe("phase_1");
  });
});

describe("sheet-scoped phases and time slots (real SQLite)", () => {
  it("keeps legacy calls on default and reconciles sheets independently", async () => {
    const db = await makeDb();
    const defaultPhase = await createPhase(db, "evt", {
      name: "Default",
      from: "09:00",
      to: "11:00",
    });
    const otherPhase = await createPhase(
      db,
      "evt",
      { name: "Other", from: "09:00", to: "11:00" },
      "sheet:other",
    );
    await regenerateTimeSlots(db, "evt", { start: "09:00", end: "11:00", stepMin: 60 }, [
      defaultPhase,
    ]);
    await regenerateTimeSlots(
      db,
      "evt",
      { start: "09:00", end: "11:00", stepMin: 60 },
      [otherPhase],
      "sheet:other",
    );

    expect((await listPhases(db, "evt")).map((phase) => phase.name)).toEqual(["Default"]);
    expect((await listPhases(db, "evt", "sheet:other")).map((phase) => phase.name)).toEqual([
      "Other",
    ]);
    expect((await listTimeSlots(db, "evt")).map((slot) => slot.phaseId)).toEqual([
      defaultPhase.id,
      defaultPhase.id,
    ]);
    expect((await listTimeSlots(db, "evt", "sheet:other")).map((slot) => slot.phaseId)).toEqual([
      otherPhase.id,
      otherPhase.id,
    ]);

    await regenerateTimeSlots(db, "evt", { start: "09:00", end: "10:00", stepMin: 60 }, [
      defaultPhase,
    ]);
    expect(
      (
        await db
          .prepare("SELECT roster_sheet_id, idx FROM time_slots ORDER BY roster_sheet_id, idx")
          .all()
      ).results,
    ).toEqual([
      { roster_sheet_id: "default:evt", idx: 0 },
      { roster_sheet_id: "sheet:other", idx: 0 },
      { roster_sheet_id: "sheet:other", idx: 1 },
    ]);

    await deletePhase(db, defaultPhase.id, "evt");
    expect(await listPhases(db, "evt")).toEqual([]);
    expect(await listPhases(db, "evt", "sheet:other")).toEqual([otherPhase]);
  });

  it("rejects a sheet or phase from another event", async () => {
    const db = await makeDb();
    await db
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, step_min, seed,
           apply_token, view_token, created_at, updated_at)
         VALUES ('evt2', 1, 'Event 2', '2026-11-07', '09:00', '11:00', 60, 1,
           'apply2', 'view2', 'created', 'updated')`,
      )
      .run();
    const foreignPhase = await createPhase(db, "evt2", {
      name: "Foreign",
      from: "09:00",
      to: "11:00",
    });
    await expect(listPhases(db, "evt", "default:evt2")).rejects.toThrow(/does not belong/);
    await expect(
      regenerateTimeSlots(db, "evt", { start: "09:00", end: "11:00", stepMin: 60 }, [foreignPhase]),
    ).rejects.toThrow(/Every phase must belong/);
  });
});
