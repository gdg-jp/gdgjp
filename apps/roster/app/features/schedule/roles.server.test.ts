import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import {
  createEventRole,
  deleteEventRole,
  listEventRoleIds,
  listRoles,
  renameEventRole,
  setEventRoles,
  toRole,
} from "./roles.server";

const migrations = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
  "0011_repair_default_sheet_compat.sql",
  "0012_independent_sheet_publication.sql",
  "0013_event_custom_roles.sql",
].map((name) => fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)));

const SEEDED = ["reception", "guide", "mc", "stream", "photo", "setup"];

async function makeDb() {
  const db = asD1(createTestD1(migrations));
  for (const id of ["evt", "evt2"]) {
    await db
      .prepare(
        `INSERT INTO events
          (id, chapter_id, name, date, start_time, end_time, step_min, seed,
           apply_token, view_token, created_at, updated_at)
         VALUES (?, 1, 'Event', '2026-11-07', '09:00', '11:00', 60, 1, ?, ?, 'created', 'updated')`,
      )
      .bind(id, `apply-${id}`, `view-${id}`)
      .run();
  }
  for (const [id, deletedAt] of [
    ["sheet:other", null],
    ["sheet:archived", "archived"],
  ]) {
    await db
      .prepare(
        `INSERT INTO roster_sheets
          (id, event_id, name, date, start_time, end_time, step_min, seed, sort_order,
           created_at, updated_at, deleted_at)
         VALUES (?, 'evt', ?, '2026-11-07', '09:00', '11:00', 60, 1, 1, 'created', 'updated', ?)`,
      )
      .bind(id, id, deletedAt)
      .run();
  }
  await db.prepare("INSERT INTO event_roles (event_id, role_id) VALUES ('evt', 'guide')").run();
  return db;
}

/** One slot + track on `sheetId`, so demands/assignments can reference them. */
async function addSlotAndTrack(db: D1Database, sheetId: string) {
  await db
    .prepare(
      `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
       VALUES (?, 'evt', 0, '09:00', '10:00', ?)`,
    )
    .bind(`slot:${sheetId}`, sheetId)
    .run();
  await db
    .prepare(
      `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
       VALUES (?, 'evt', 'Hall', '#fff', 0, 0, ?)`,
    )
    .bind(`track:${sheetId}`, sheetId)
    .run();
}

async function addDemand(db: D1Database, sheetId: string, roleId: string, ideal: number) {
  await db
    .prepare(
      `INSERT INTO demands
        (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, roster_sheet_id)
       VALUES ('evt', ?, ?, ?, 0, ?, ?)`,
    )
    .bind(`slot:${sheetId}`, `track:${sheetId}`, roleId, ideal, sheetId)
    .run();
}

async function addApplicant(db: D1Database, id: string, roleId: string) {
  await db
    .prepare(
      `INSERT INTO applications (id, event_id, email, name, created_at, updated_at)
       VALUES (?, 'evt', ?, ?, 'created', 'updated')`,
    )
    .bind(id, `${id}@example.com`, id)
    .run();
  await db
    .prepare("INSERT INTO application_skills (application_id, role_id) VALUES (?, ?)")
    .bind(id, roleId)
    .run();
}

async function addAssignment(
  db: D1Database,
  sheetId: string,
  applicationId: string,
  roleId: string,
) {
  await db
    .prepare(
      `INSERT INTO assignments
        (event_id, application_id, time_slot_id, track_id, role_id, roster_sheet_id)
       VALUES ('evt', ?, ?, ?, ?, ?)`,
    )
    .bind(applicationId, `slot:${sheetId}`, `track:${sheetId}`, roleId, sheetId)
    .run();
}

async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${sql}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("toRole", () => {
  it("maps snake_case columns and marks event-owned rows as custom", () => {
    expect(toRole({ id: "reception", name: "受付", sort_order: 1, event_id: null })).toEqual({
      id: "reception",
      name: "受付",
      sortOrder: 1,
      custom: false,
    });
    expect(toRole({ id: "r1", name: "クローク", sort_order: 7, event_id: "evt" }).custom).toBe(
      true,
    );
  });
});

describe("sheet role selection", () => {
  it("replaces role selection only on the chosen sheet and leaves the master and event_roles alone", async () => {
    const db = await makeDb();
    await setEventRoles(db, "evt", ["reception"]);
    expect(await listEventRoleIds(db, "evt")).toEqual(["reception"]);
    expect(await listEventRoleIds(db, "evt", "sheet:other")).toEqual([]);
    expect((await listRoles(db, "evt")).map((role) => role.id)).toEqual(SEEDED);
    expect(
      (await db.prepare("SELECT role_id FROM event_roles WHERE event_id = 'evt'").all()).results,
    ).toEqual([{ role_id: "guide" }]);

    await setEventRoles(db, "evt", ["guide"], "sheet:other");
    expect(await listEventRoleIds(db, "evt")).toEqual(["reception"]);
    expect(await listEventRoleIds(db, "evt", "sheet:other")).toEqual(["guide"]);
  });

  it("rejects an explicit sheet outside the event", async () => {
    const db = await makeDb();
    await expect(setEventRoles(db, "evt", ["guide"], "missing")).rejects.toThrow(
      "Roster sheet does not belong to this event or is not live",
    );
    await expect(createEventRole(db, "evt2", "sheet:other", "クローク")).rejects.toThrow(
      "Roster sheet does not belong to this event or is not live",
    );
    await expect(createEventRole(db, "evt", "sheet:archived", "クローク")).rejects.toThrow(
      "Roster sheet does not belong to this event or is not live",
    );
  });
});

describe("event-owned roles", () => {
  it("appends a created role after the seeded ones and selects it only on its sheet", async () => {
    const db = await makeDb();
    await setEventRoles(db, "evt", ["guide"], "sheet:other");
    const cloak = await createEventRole(db, "evt", "default:evt", "クローク");
    const ta = await createEventRole(db, "evt", "default:evt", "TA");

    expect(cloak).toMatchObject({ name: "クローク", sortOrder: 7, custom: true });
    expect(ta.sortOrder).toBe(8);
    expect((await listRoles(db, "evt")).map((role) => role.id)).toEqual([
      ...SEEDED,
      cloak.id,
      ta.id,
    ]);
    // "guide" is the fixture's legacy event_roles row, mirrored onto the default sheet by 0008.
    expect(await listEventRoleIds(db, "evt")).toEqual(["guide", cloak.id, ta.id].sort());
    expect(await listEventRoleIds(db, "evt", "sheet:other")).toEqual(["guide"]);
  });

  it("never shows one event's roles to another event", async () => {
    const db = await makeDb();
    const cloak = await createEventRole(db, "evt", "default:evt", "クローク");
    const other = await createEventRole(db, "evt2", "default:evt2", "クローク");

    expect((await listRoles(db, "evt2")).map((role) => role.id)).toEqual([...SEEDED, other.id]);
    expect((await listRoles(db, "evt")).map((role) => role.id)).not.toContain(other.id);
    expect(other.sortOrder).toBe(7);
    expect(cloak.id).not.toBe(other.id);
  });

  it("rejects an exact duplicate name within one event at the database", async () => {
    const db = await makeDb();
    await createEventRole(db, "evt", "default:evt", "クローク");
    await expect(createEventRole(db, "evt", "default:evt", "クローク")).rejects.toThrow(/UNIQUE/);
  });

  it("renames only the event's own roles", async () => {
    const db = await makeDb();
    const cloak = await createEventRole(db, "evt", "default:evt", "クローク");

    expect(await renameEventRole(db, "evt", cloak.id, "クローク・荷物")).toBe(true);
    expect(await renameEventRole(db, "evt", "reception", "総合受付")).toBe(false);
    expect(await renameEventRole(db, "evt2", cloak.id, "乗っ取り")).toBe(false);

    const names = new Map((await listRoles(db, "evt")).map((role) => [role.id, role.name]));
    expect(names.get(cloak.id)).toBe("クローク・荷物");
    expect(names.get("reception")).toBe("受付");
  });
});

describe("deleteEventRole", () => {
  it("refuses seeded roles and other events' roles without touching their rows", async () => {
    const db = await makeDb();
    await addSlotAndTrack(db, "default:evt");
    await addDemand(db, "default:evt", "reception", 0);
    await addApplicant(db, "app-1", "reception");
    const foreign = await createEventRole(db, "evt2", "default:evt2", "クローク");

    expect(await deleteEventRole(db, "evt", "reception")).toBe("not-found");
    expect(await deleteEventRole(db, "evt", foreign.id)).toBe("not-found");
    expect(await count(db, "demands WHERE role_id = 'reception'")).toBe(1);
    expect(await count(db, "application_skills WHERE role_id = 'reception'")).toBe(1);
    expect(await count(db, "roles WHERE id = ?", foreign.id)).toBe(1);
  });

  it("refuses a role a live sheet still needs and deletes nothing", async () => {
    const db = await makeDb();
    await addSlotAndTrack(db, "default:evt");
    await addSlotAndTrack(db, "sheet:other");
    const demanded = await createEventRole(db, "evt", "default:evt", "クローク");
    const assigned = await createEventRole(db, "evt", "sheet:other", "TA");
    await addDemand(db, "default:evt", demanded.id, 2);
    await addApplicant(db, "app-1", demanded.id);
    await addApplicant(db, "app-2", assigned.id);
    await addAssignment(db, "sheet:other", "app-2", assigned.id);

    expect(await deleteEventRole(db, "evt", demanded.id)).toBe("in-use");
    expect(await deleteEventRole(db, "evt", assigned.id)).toBe("in-use");
    for (const role of [demanded, assigned]) {
      expect(await count(db, "roles WHERE id = ?", role.id)).toBe(1);
      expect(await count(db, "roster_sheet_roles WHERE role_id = ?", role.id)).toBe(1);
      expect(await count(db, "application_skills WHERE role_id = ?", role.id)).toBe(1);
    }
    expect(await count(db, "demands WHERE role_id = ?", demanded.id)).toBe(1);
    expect(await count(db, "assignments WHERE role_id = ?", assigned.id)).toBe(1);
  });

  it("deletes an unused role with its zero demands, skills, selections, and archived-sheet rows", async () => {
    const db = await makeDb();
    await addSlotAndTrack(db, "default:evt");
    await addSlotAndTrack(db, "sheet:archived");
    const cloak = await createEventRole(db, "evt", "default:evt", "クローク");
    await setEventRoles(db, "evt", [cloak.id], "sheet:other");
    await db
      .prepare("INSERT INTO roster_sheet_roles (roster_sheet_id, role_id) VALUES (?, ?)")
      .bind("sheet:archived", cloak.id)
      .run();
    await addDemand(db, "default:evt", cloak.id, 0);
    await addDemand(db, "sheet:archived", cloak.id, 3);
    await addApplicant(db, "app-1", cloak.id);
    await addAssignment(db, "sheet:archived", "app-1", cloak.id);

    expect(await deleteEventRole(db, "evt", cloak.id)).toBe("deleted");
    expect(await count(db, "roles WHERE id = ?", cloak.id)).toBe(0);
    for (const table of ["demands", "assignments", "application_skills", "roster_sheet_roles"]) {
      expect(await count(db, `${table} WHERE role_id = ?`, cloak.id)).toBe(0);
    }
    expect(await count(db, "applications WHERE id = 'app-1'")).toBe(1);
    expect(await deleteEventRole(db, "evt", cloak.id)).toBe("not-found");
  });
});
