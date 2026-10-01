import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { asD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";
import { getDefaultRosterSheet, getRosterSheet, listRosterSheets } from "./roster-sheets.server";

const migrations = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
].map((name) => fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)));

const insertEvent = `INSERT INTO events
  (id, chapter_id, name, date, start_time, end_time, step_min, no_solo_newcomer,
   max_consecutive, seed, status, apply_token, view_token, revision_cursor, created_at, updated_at)
  VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '18:00', 30, 0, 3, 42, ?, ?, ?, 1, 'created', 'updated')`;

describe("roster sheet expansion migration", () => {
  it("preserves every legacy row, token, availability and snapshot while backfilling sheets", () => {
    const raw = new DatabaseSync(":memory:");
    try {
      raw.exec("PRAGMA foreign_keys = ON");
      for (const migration of migrations.slice(0, -1)) raw.exec(readFileSync(migration, "utf8"));
      for (const status of ["draft", "open", "closed", "published", "ended"]) {
        raw.prepare(insertEvent).run(status, status, `apply-${status}`, `view-${status}`);
      }
      raw.exec(`
        UPDATE events SET deleted_at = 'deleted' WHERE id = 'ended';
        INSERT INTO phases VALUES ('phase', 'published', 'Main', '09:00', '18:00', 0);
        INSERT INTO time_slots VALUES ('slot', 'published', 0, '09:00', '09:30', 'phase');
        INSERT INTO tracks VALUES ('track', 'published', 'Hall', '#fff', 0, 0);
        INSERT INTO event_roles VALUES ('published', 'reception');
        INSERT INTO demands VALUES ('published', 'slot', 'track', 'reception', 1, 2, 1, 1);
        INSERT INTO applications (id, event_id, email, name, created_at, updated_at)
          VALUES ('staff', 'published', 'staff@example.com', 'Staff', 'created', 'updated');
        INSERT INTO application_skills VALUES ('staff', 'reception', 'lead', 2);
        INSERT INTO availabilities VALUES ('staff', 'slot', 'o');
        INSERT INTO assignments VALUES ('published', 'staff', 'slot', 'track', 'reception', 1);
        INSERT INTO revisions VALUES ('revision', 'published', 1, 'Generate', 'Owner', 'owner',
          'generate', NULL, '{"v":1,"items":[{"a":"staff","s":"slot","t":"track","r":"reception","l":true}]}',
          '{"coverage":1}', 'created');
      `);
      const tables = [
        "events",
        "phases",
        "time_slots",
        "tracks",
        "event_roles",
        "demands",
        "applications",
        "application_skills",
        "availabilities",
        "assignments",
        "revisions",
      ];
      const before = tables.map((table) => raw.prepare(`SELECT * FROM ${table}`).all());
      raw.exec(readFileSync(migrations[migrations.length - 1], "utf8"));

      for (const [index, table] of tables.entries()) {
        const after = raw.prepare(`SELECT * FROM ${table}`).all();
        expect(after).toHaveLength(before[index].length);
        for (const [rowIndex, row] of after.entries()) {
          const { roster_sheet_id: sheetId, ...legacy } = row;
          expect(legacy).toEqual(before[index][rowIndex]);
          if (sheetId !== undefined) expect(sheetId).toBe(`default:${legacy.event_id}`);
        }
      }
      expect(raw.prepare("SELECT * FROM roster_sheets WHERE event_id = 'published'").get()).toEqual(
        {
          id: "default:published",
          event_id: "published",
          name: "本編",
          date: "2026-11-07",
          start_time: "09:00",
          end_time: "18:00",
          step_min: 30,
          no_solo_newcomer: 0,
          max_consecutive: 3,
          seed: 42,
          visibility: "published",
          sort_order: 0,
          revision_cursor: 1,
          created_at: "created",
          updated_at: "updated",
          deleted_at: null,
        },
      );
      expect(raw.prepare("SELECT COUNT(*) AS count FROM roster_sheets").get()).toEqual({
        count: 5,
      });
      expect(
        raw.prepare("SELECT event_id FROM roster_sheets WHERE visibility = 'published'").all(),
      ).toEqual([{ event_id: "published" }]);
      expect(
        raw.prepare("SELECT deleted_at FROM roster_sheets WHERE event_id = 'ended'").get(),
      ).toEqual({ deleted_at: "deleted" });
      expect(raw.prepare("SELECT * FROM roster_sheet_roles").all()).toEqual([
        { roster_sheet_id: "default:published", role_id: "reception" },
      ]);
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

      // A deployed legacy writer can still insert without the new nullable field.
      raw.exec("INSERT INTO tracks VALUES ('later', 'published', 'Later', '#fff', 0, 1, NULL)");
      // Keep the existing uniqueness constraints until the later contract migration.
      expect(() =>
        raw.exec(
          "INSERT INTO time_slots VALUES ('duplicate', 'published', 0, '10:00', '10:30', NULL, NULL)",
        ),
      ).toThrow(/UNIQUE/);
      raw.exec("DELETE FROM events WHERE id = 'published'");
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      raw.close();
    }
  });
});

describe("roster sheet accessors", () => {
  async function seedDb() {
    const testDb = createTestD1(migrations);
    await testDb.prepare(insertEvent).bind("event", "draft", "apply", "view").run();
    for (const [id, order] of [
      ["main", 0],
      ["party", 1],
      ["deleted", -1],
    ] as const) {
      await testDb
        .prepare(`INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, seed, sort_order, created_at, updated_at, deleted_at)
        VALUES (?, 'event', ?, '2026-11-07', '09:00', '18:00', 42, ?, 'created', 'updated', ?)`)
        .bind(id, id, order, id === "deleted" ? "deleted" : null)
        .run();
    }
    return asD1(testDb);
  }

  it("lists live sheets in order and resolves the default and an event-scoped sheet", async () => {
    const db = await seedDb();
    expect((await listRosterSheets(db, "event")).map((sheet) => sheet.id)).toEqual([
      "main",
      "party",
    ]);
    expect(await getDefaultRosterSheet(db, "event")).toMatchObject({
      id: "main",
      eventId: "event",
      noSoloNewcomer: true,
      revisionCursor: null,
      visibility: "private",
      stepMin: 60,
      maxConsecutive: 4,
    });
    expect((await getRosterSheet(db, "event", "party"))?.id).toBe("party");
    expect(await getRosterSheet(db, "other-event", "party")).toBeNull();
    expect(await getRosterSheet(db, "event", "deleted")).toBeNull();
    expect(await getDefaultRosterSheet(db, "unknown")).toBeNull();
    expect(await listRosterSheets(db, "unknown")).toEqual([]);
  });

  it("never resolves a sheet beneath a deleted event", async () => {
    const db = await seedDb();
    await db.prepare("UPDATE events SET deleted_at = 'deleted' WHERE id = 'event'").run();
    expect(await listRosterSheets(db, "event")).toEqual([]);
    expect(await getDefaultRosterSheet(db, "event")).toBeNull();
    expect(await getRosterSheet(db, "event", "main")).toBeNull();
  });
});
