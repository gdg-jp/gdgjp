import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { buildSolverInput } from "./solver-input.server";

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

const EVENT = { id: "evt_1", noSoloNewcomer: true, maxConsecutive: 4 };

async function seedBase(db: TestD1Database) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
       VALUES ('evt_1', 1, 'DevFest', '2026-11-07', '09:00', '19:00', 1, 'tok1', 'view1', ?, ?)`,
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO tracks (id, event_id, name, color, shared, sort_order) VALUES ('trk_1', 'evt_1', '全体', '#000', 1, 0)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO event_roles (event_id, role_id) VALUES ('evt_1', 'reception'), ('evt_1', 'guide')",
    )
    .run();
  for (let i = 0; i < 3; i++) {
    await db
      .prepare(
        "INSERT INTO time_slots (id, event_id, idx, start_time, end_time) VALUES (?, 'evt_1', ?, ?, ?)",
      )
      .bind(`slot_${i}`, i, `0${9 + i}:00`, `0${10 + i}:00`)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max)
       VALUES ('evt_1', 'slot_0', 'trk_1', 'reception', 1, 2, 1, 2)`,
    )
    .run();
}

async function seedApplication(
  db: TestD1Database,
  id: string,
  opts: { withdrawn?: boolean; roleId?: string; level?: string; pref?: number } = {},
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, user_id, email, name, withdrawn, created_at, updated_at)
       VALUES (?, 'evt_1', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, `user_${id}`, `${id}@example.com`, id, opts.withdrawn ? 1 : 0, now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO application_skills (application_id, role_id, level, pref) VALUES (?, ?, ?, ?)",
    )
    .bind(id, opts.roleId ?? "reception", opts.level ?? "exp", opts.pref ?? 2)
    .run();
  await db
    .prepare("INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, ?, ?)")
    .bind(id, "slot_0", "o")
    .run();
}

describe("buildSolverInput", () => {
  let testDb: TestD1Database;

  beforeEach(async () => {
    testDb = createTestD1(MIGRATIONS);
    await seedBase(testDb);
  });

  it("is deterministic: two calls against unchanged data produce identically-ordered output", async () => {
    // Insert out of any "natural" order so a naive un-ordered SELECT would
    // be exposed by this test.
    await seedApplication(testDb, "app_z");
    await seedApplication(testDb, "app_a");
    await seedApplication(testDb, "app_m");

    const first = await buildSolverInput(asD1(testDb), EVENT, 42);
    const second = await buildSolverInput(asD1(testDb), EVENT, 42);

    expect(second).toEqual(first);
    expect(second.applications.map((a) => a.id)).toEqual(first.applications.map((a) => a.id));
    expect([...second.demands.keys()]).toEqual([...first.demands.keys()]);
  });

  it("sorts applications by id regardless of insertion order", async () => {
    await seedApplication(testDb, "app_z");
    await seedApplication(testDb, "app_a");
    await seedApplication(testDb, "app_m");

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.applications.map((a) => a.id)).toEqual(["app_a", "app_m", "app_z"]);
  });

  it("excludes a withdrawn applicant from SolverInput entirely", async () => {
    await seedApplication(testDb, "app_active");
    await seedApplication(testDb, "app_gone", { withdrawn: true });

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.applications.map((a) => a.id)).toEqual(["app_active"]);
  });

  it("excludes an ideal=0 demand row even if one somehow exists in the table", async () => {
    await testDb
      .prepare(
        `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, lead_min, new_max)
         VALUES ('evt_1', 'slot_1', 'trk_1', 'guide', 0, 0, 0, 99)`,
      )
      .run();

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.demands.has("slot_1|trk_1|guide")).toBe(false);
    expect(input.demands.has("slot_0|trk_1|reception")).toBe(true);
  });

  it("filters roles to the event's selected event_roles, not the whole roles master", async () => {
    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.roles).toEqual([{ id: "reception" }, { id: "guide" }]);
  });

  it("maps demand rows onto the solver's flattened Demand shape, keyed by demandKey", async () => {
    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.demands.get("slot_0|trk_1|reception")).toEqual({
      min: 1,
      ideal: 2,
      leadMin: 1,
      newMax: 2,
    });
  });

  it("maps an application's skills and availability into Record form", async () => {
    await seedApplication(testDb, "app_1", { roleId: "reception", level: "lead", pref: 1 });

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    const app = input.applications.find((a) => a.id === "app_1");
    expect(app).toEqual({
      id: "app_1",
      withdrawn: false,
      skills: { reception: { level: "lead", pref: 1 } },
      availability: { slot_0: "o" },
    });
  });

  it("builds options from the event's noSoloNewcomer/maxConsecutive and the given seed", async () => {
    const input = await buildSolverInput(
      asD1(testDb),
      { id: "evt_1", noSoloNewcomer: false, maxConsecutive: 6 },
      777,
    );
    expect(input.options).toEqual({ noSoloNewcomer: false, maxConsecutive: 6, seed: 777 });
  });

  it("orders slots by idx", async () => {
    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.slots).toEqual([
      { id: "slot_0", idx: 0 },
      { id: "slot_1", idx: 1 },
      { id: "slot_2", idx: 2 },
    ]);
  });
});
