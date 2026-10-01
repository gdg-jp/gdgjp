import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { type TestD1Database, asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { solve } from "../solver/solve";
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
const OTHER_SHEET = "sheet:other";

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
      .bind(
        `slot_${i}`,
        i,
        `${String(9 + i).padStart(2, "0")}:00`,
        `${String(10 + i).padStart(2, "0")}:00`,
      )
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

async function addSiblingAssignment(
  db: TestD1Database,
  input: {
    applicationId: string;
    sheetId: string;
    date: string;
    start: string;
    end: string;
    archived?: boolean;
  },
) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO roster_sheets (id, event_id, name, date, start_time, end_time, step_min,
         no_solo_newcomer, max_consecutive, seed, visibility, sort_order, created_at, updated_at,
         deleted_at)
       VALUES (?, 'evt_1', ?, ?, '09:00', '12:00', 60, 1, 4, 1, 'private', 1, ?, ?, ?)`,
    )
    .bind(input.sheetId, input.sheetId, input.date, now, now, input.archived ? now : null)
    .run();
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES (?, 'evt_1', 0, ?, ?, ?)`,
    )
    .bind(`${input.sheetId}:slot`, input.start, input.end, input.sheetId)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES (?, 'evt_1', '別枠', '#fff', 0, 0, ?)`,
    )
    .bind(`${input.sheetId}:track`, input.sheetId)
    .run();
  await db
    .prepare(
      `INSERT INTO assignments (event_id, roster_sheet_id, application_id, time_slot_id,
         track_id, role_id, locked)
       VALUES ('evt_1', ?, ?, ?, ?, 'reception', 0)`,
    )
    .bind(input.sheetId, input.applicationId, `${input.sheetId}:slot`, `${input.sheetId}:track`)
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

  it("blocks overlapping live sibling assignments in generated input and solve", async () => {
    await seedApplication(testDb, "app_overlap");
    await seedApplication(testDb, "app_adjacent");
    await seedApplication(testDb, "app_other_date");
    await seedApplication(testDb, "app_archived");
    await testDb
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES (?, 'slot_1', 'o')",
      )
      .bind("app_adjacent")
      .run();
    await addSiblingAssignment(testDb, {
      applicationId: "app_overlap",
      sheetId: "sheet_overlap",
      date: "2026-11-07",
      start: "09:30",
      end: "10:30",
    });
    await addSiblingAssignment(testDb, {
      applicationId: "app_adjacent",
      sheetId: "sheet_adjacent",
      date: "2026-11-07",
      start: "10:00",
      end: "11:00",
    });
    await addSiblingAssignment(testDb, {
      applicationId: "app_other_date",
      sheetId: "sheet_other_date",
      date: "2026-11-08",
      start: "09:30",
      end: "10:30",
    });
    await addSiblingAssignment(testDb, {
      applicationId: "app_archived",
      sheetId: "sheet_archived",
      date: "2026-11-07",
      start: "09:30",
      end: "10:30",
      archived: true,
    });

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    const availabilityById = new Map(input.applications.map((app) => [app.id, app.availability]));

    expect(availabilityById.get("app_overlap")?.slot_0).toBe("x");
    expect(availabilityById.get("app_adjacent")?.slot_0).toBe("o");
    expect(availabilityById.get("app_adjacent")?.slot_1).toBe("x");
    expect(availabilityById.get("app_other_date")?.slot_0).toBe("o");
    expect(availabilityById.get("app_archived")?.slot_0).toBe("o");
    expect(solve(input).assignments.has("app_overlap|slot_0")).toBe(false);
  });

  it("makes an overlapping sole candidate unavailable to the solver", async () => {
    await seedApplication(testDb, "app_only_candidate");
    await addSiblingAssignment(testDb, {
      applicationId: "app_only_candidate",
      sheetId: "sheet_only_candidate",
      date: "2026-11-07",
      start: "09:30",
      end: "10:30",
    });

    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.applications[0].availability.slot_0).toBe("x");

    const unblockedInput = {
      ...input,
      applications: input.applications.map((application) => ({
        ...application,
        availability: { ...application.availability, slot_0: "o" as const },
      })),
    };
    expect(solve(unblockedInput).assignments.has("app_only_candidate|slot_0")).toBe(true);
    expect(solve(input).assignments.has("app_only_candidate|slot_0")).toBe(false);
  });

  it("uses the live default sheet's settings and seed when no seed is supplied", async () => {
    const input = await buildSolverInput(asD1(testDb), { id: "evt_1" });
    expect(input.options).toEqual({ noSoloNewcomer: true, maxConsecutive: 4, seed: 1 });
  });

  it("uses an explicitly supplied seed override", async () => {
    const input = await buildSolverInput(asD1(testDb), { id: "evt_1" }, 777);
    expect(input.options.seed).toBe(777);
  });

  it("orders slots by idx", async () => {
    const input = await buildSolverInput(asD1(testDb), EVENT, 1);
    expect(input.slots).toEqual([
      { id: "slot_0", idx: 0 },
      { id: "slot_1", idx: 1 },
      { id: "slot_2", idx: 2 },
    ]);
  });

  it("uses only the selected sheet's domain rows, availability, assignments and settings", async () => {
    const now = new Date().toISOString();
    await testDb
      .prepare(
        `INSERT INTO roster_sheets (id, event_id, name, date, start_time, end_time, step_min,
           no_solo_newcomer, max_consecutive, seed, visibility, sort_order, created_at, updated_at)
         VALUES (?, 'evt_1', '別枠', '2026-11-08', '09:00', '10:00', 60, 0, 2, 99, 'private', 1, ?, ?)`,
      )
      .bind(OTHER_SHEET, now, now)
      .run();
    await testDb
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot_other', 'evt_1', 0, '09:00', '10:00', ?)`,
      )
      .bind(OTHER_SHEET)
      .run();
    await testDb
      .prepare(
        `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
         VALUES ('track_other', 'evt_1', '別トラック', '#fff', 0, 0, ?)`,
      )
      .bind(OTHER_SHEET)
      .run();
    await testDb
      .prepare("INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES (?, 'guide')")
      .bind(OTHER_SHEET)
      .run();
    await testDb
      .prepare(
        `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count,
           lead_min, new_max, roster_sheet_id)
         VALUES ('evt_1', 'slot_other', 'track_other', 'guide', 1, 1, 0, 1, ?)`,
      )
      .bind(OTHER_SHEET)
      .run();
    await seedApplication(testDb, "app_1", { roleId: "guide" });
    await testDb
      .prepare(
        "INSERT INTO availabilities (application_id, time_slot_id, value) VALUES ('app_1', 'slot_other', 'd')",
      )
      .run();
    await testDb
      .prepare(
        `INSERT INTO assignments (event_id, roster_sheet_id, application_id, time_slot_id,
           track_id, role_id, locked)
         VALUES ('evt_1', ?, 'app_1', 'slot_other', 'track_other', 'guide', 1)`,
      )
      .bind(OTHER_SHEET)
      .run();
    await testDb
      .prepare(
        `INSERT INTO assignments (event_id, roster_sheet_id, application_id, time_slot_id,
           track_id, role_id, locked)
         VALUES ('evt_1', 'default:evt_1', 'app_1', 'slot_0', 'trk_1', 'reception', 0)`,
      )
      .run();

    const input = await buildSolverInput(asD1(testDb), EVENT, undefined, OTHER_SHEET);

    expect(input.slots).toEqual([{ id: "slot_other", idx: 0 }]);
    expect(input.tracks).toEqual([{ id: "track_other" }]);
    expect(input.roles).toEqual([{ id: "guide" }]);
    expect([...input.demands.keys()]).toEqual(["slot_other|track_other|guide"]);
    expect(input.applications[0].availability).toEqual({ slot_other: "d" });
    expect(input.existingAssignments).toEqual(
      new Map([["app_1|slot_other", { trackId: "track_other", roleId: "guide", locked: true }]]),
    );
    expect(input.options).toEqual({ noSoloNewcomer: false, maxConsecutive: 2, seed: 99 });
  });

  it("rejects a sheet that is missing or belongs to another event", async () => {
    await expect(buildSolverInput(asD1(testDb), EVENT, 1, "sheet:missing")).rejects.toThrow(
      "Roster sheet not found",
    );
  });
});
