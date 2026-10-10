import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { type RoleIntent, handleRoleIntent } from "./role-intents.server";
import { CUSTOM_ROLE_LIMIT } from "./role-name";
import { createEventRole, listEventRoleIds, listRoles } from "./roles.server";

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

const SHEET = "default:evt";

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
  return db;
}

function run(db: D1Database, intent: RoleIntent, fields: Record<string, string | string[]> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  }
  return handleRoleIntent(db, "evt", SHEET, intent, form);
}

async function customNames(db: D1Database): Promise<string[]> {
  return (await listRoles(db, "evt")).filter((r) => r.custom).map((r) => r.name);
}

describe("handleRoleIntent", () => {
  it("setRoles keeps only roles this event can see", async () => {
    const db = await makeDb();
    const own = await createEventRole(db, "evt", SHEET, "クローク");
    const foreign = await createEventRole(db, "evt2", "default:evt2", "TA");

    await expect(
      run(db, "setRoles", { roleId: ["guide", own.id, foreign.id, "unknown"] }),
    ).resolves.toEqual({ ok: true });
    expect(await listEventRoleIds(db, "evt", SHEET)).toEqual(["guide", own.id].sort());
  });

  it("createRole creates a selected role and rejects bad or duplicate names", async () => {
    const db = await makeDb();
    await expect(run(db, "createRole", { name: " クローク " })).resolves.toEqual({ ok: true });
    const [cloak] = (await listRoles(db, "evt")).filter((r) => r.custom);
    expect(cloak.name).toBe("クローク");
    expect(await listEventRoleIds(db, "evt", SHEET)).toEqual([cloak.id]);

    await expect(run(db, "createRole", { name: "" })).resolves.toEqual({
      error: "役割名を入力してください。",
    });
    await expect(run(db, "createRole", { name: "受付" })).resolves.toEqual({
      error: "「受付」という役割はすでにあります。",
    });
    await expect(run(db, "createRole", { name: "クローク" })).resolves.toMatchObject({
      error: expect.stringContaining("すでにあります"),
    });
    expect(await customNames(db)).toEqual(["クローク"]);
  });

  it("createRole stops at the per-event limit", async () => {
    const db = await makeDb();
    for (let i = 0; i < CUSTOM_ROLE_LIMIT; i++) {
      await expect(run(db, "createRole", { name: `役割${i}` })).resolves.toEqual({ ok: true });
    }
    await expect(run(db, "createRole", { name: "もう一つ" })).resolves.toEqual({
      error: `独自の役割は${CUSTOM_ROLE_LIMIT}件まで作成できます。`,
    });
  });

  it("renameRole renames only this event's own roles", async () => {
    const db = await makeDb();
    const cloak = await createEventRole(db, "evt", SHEET, "クローク");
    await createEventRole(db, "evt", SHEET, "TA");
    const foreign = await createEventRole(db, "evt2", "default:evt2", "記録補助");

    await expect(run(db, "renameRole", { roleId: cloak.id, name: "クローク" })).resolves.toEqual({
      ok: true,
    });
    await expect(
      run(db, "renameRole", { roleId: cloak.id, name: "クローク・荷物" }),
    ).resolves.toEqual({ ok: true });
    await expect(run(db, "renameRole", { roleId: cloak.id, name: "ｔａ" })).resolves.toMatchObject({
      error: expect.stringContaining("すでにあります"),
    });
    const notFound = { error: "役割が見つかりません。画面を更新してお試しください。" };
    await expect(run(db, "renameRole", { roleId: "reception", name: "総合受付" })).resolves.toEqual(
      notFound,
    );
    await expect(run(db, "renameRole", { roleId: foreign.id, name: "乗っ取り" })).resolves.toEqual(
      notFound,
    );
    expect(await customNames(db)).toEqual(["クローク・荷物", "TA"]);
    expect((await listRoles(db, "evt2")).find((r) => r.id === foreign.id)?.name).toBe("記録補助");
  });

  it("deleteRole reports in-use and not-found, and deletes an unused role", async () => {
    const db = await makeDb();
    const cloak = await createEventRole(db, "evt", SHEET, "クローク");
    await db
      .prepare(
        `INSERT INTO time_slots (id, event_id, idx, start_time, end_time, roster_sheet_id)
         VALUES ('slot', 'evt', 0, '09:00', '10:00', ?)`,
      )
      .bind(SHEET)
      .run();
    await db
      .prepare(
        `INSERT INTO tracks (id, event_id, name, color, shared, sort_order, roster_sheet_id)
         VALUES ('track', 'evt', 'Hall', '#fff', 0, 0, ?)`,
      )
      .bind(SHEET)
      .run();
    await db
      .prepare(
        `INSERT INTO demands (event_id, time_slot_id, track_id, role_id, min_count, ideal_count, roster_sheet_id)
         VALUES ('evt', 'slot', 'track', ?, 1, 1, ?)`,
      )
      .bind(cloak.id, SHEET)
      .run();

    await expect(run(db, "deleteRole", { roleId: cloak.id })).resolves.toEqual({
      error:
        "需要または割当で使われているため削除できません。先に需要を0にし、割当を外してください。",
    });
    await expect(run(db, "deleteRole", { roleId: "reception" })).resolves.toEqual({
      error: "役割が見つかりません。画面を更新してお試しください。",
    });

    await db.prepare("UPDATE demands SET min_count = 0, ideal_count = 0").run();
    await expect(run(db, "deleteRole", { roleId: cloak.id })).resolves.toEqual({ ok: true });
    expect(await customNames(db)).toEqual([]);
  });
});
