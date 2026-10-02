import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrationNames = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
];
const readMigration = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

describe("time slot sheet uniqueness migration", () => {
  let db: DatabaseSync;
  const migrate = () => {
    // Match D1's transaction and permanently enabled foreign keys.
    db.exec("BEGIN");
    db.exec(readMigration("0009_time_slots_sheet_uniqueness.sql"));
    db.exec("COMMIT");
  };

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const name of migrationNames) db.exec(readMigration(name));
    db.exec(`
      INSERT INTO events
        (id, chapter_id, name, date, start_time, end_time, seed,
         apply_token, view_token, created_at, updated_at)
      VALUES ('event', 1, 'DevFest', '2026-11-07', '09:00', '18:00', 42,
        'apply', 'view', 'created', 'updated');
      INSERT INTO roster_sheets
        (id, event_id, name, date, start_time, end_time, seed, created_at, updated_at)
      VALUES ('party', 'event', 'Party', '2026-11-07', '18:00', '20:00', 42,
        'created', 'updated');
      INSERT INTO phases VALUES ('phase', 'event', 'Main', '09:00', '18:00', 0, NULL);
      INSERT INTO time_slots VALUES ('slot', 'event', 0, '09:00', '10:00', 'phase', NULL);
      INSERT INTO tracks VALUES ('track', 'event', 'Hall', '#fff', 0, 0, NULL);
      INSERT INTO applications (id, event_id, email, name, created_at, updated_at)
        VALUES ('staff', 'event', 'staff@example.com', 'Staff', 'created', 'updated');
      INSERT INTO demands VALUES ('event', 'slot', 'track', 'reception', 1, 2, 1, 3, NULL);
      INSERT INTO availabilities VALUES ('staff', 'slot', 'd');
      INSERT INTO assignments VALUES ('event', 'staff', 'slot', 'track', 'reception', 1, NULL);
    `);
  });
  afterEach(() => db.close());

  it("preserves all rows and IDs with foreign keys enabled inside a transaction", () => {
    // Include historically unscoped rows even when a default sheet exists.
    db.exec(`
      INSERT INTO time_slots VALUES ('legacy', 'event', 1, '10:00', '11:00', NULL, NULL);
      INSERT INTO demands VALUES ('event', 'legacy', 'track', 'guide', 2, 3, 0, 9, NULL);
      INSERT INTO availabilities VALUES ('staff', 'legacy', 'x');
      INSERT INTO assignments VALUES ('event', 'staff', 'legacy', 'track', 'guide', 0, NULL);
      UPDATE time_slots SET roster_sheet_id = NULL WHERE id = 'legacy';
      UPDATE demands SET roster_sheet_id = NULL WHERE time_slot_id = 'legacy';
      UPDATE assignments SET roster_sheet_id = NULL WHERE time_slot_id = 'legacy';
    `);
    const tables = [
      "events",
      "roster_sheets",
      "phases",
      "time_slots",
      "tracks",
      "applications",
      "demands",
      "availabilities",
      "assignments",
    ];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    migrate();
    for (const [index, table] of tables.entries()) {
      expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), table).toEqual(
        before[index],
      );
    }
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db
        .prepare("PRAGMA index_list(time_slots)")
        .all()
        .map((index) => index.name),
    ).toEqual(
      expect.arrayContaining([
        "time_slots_event_idx",
        "time_slots_sheet_idx",
        "time_slots_legacy_event_idx",
      ]),
    );
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB '_0009_*'").all()).toEqual(
      [],
    );
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'time_slots_rebuilt'").all(),
    ).toEqual([]);
  });

  it("allows the same event index across sheets while rejecting duplicates within a sheet", () => {
    migrate();
    db.exec(
      "INSERT INTO time_slots VALUES ('party-slot', 'event', 0, '18:00', '19:00', NULL, 'party')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO time_slots VALUES ('duplicate', 'event', 0, '19:00', '20:00', NULL, 'party')",
      ),
    ).toThrow(/UNIQUE/);
    expect(() =>
      db.exec(
        "INSERT INTO time_slots VALUES ('duplicate-main', 'event', 0, '10:00', '11:00', NULL, 'default:event')",
      ),
    ).toThrow(/UNIQUE/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps legacy inserts scoped and rejects legacy duplicates after the trigger runs", () => {
    migrate();
    db.exec("INSERT INTO time_slots VALUES ('legacy', 'event', 1, '10:00', '11:00', NULL, NULL)");
    expect(db.prepare("SELECT roster_sheet_id FROM time_slots WHERE id = 'legacy'").get()).toEqual({
      roster_sheet_id: "default:event",
    });
    expect(() =>
      db.exec(
        "INSERT INTO time_slots VALUES ('duplicate', 'event', 0, '10:00', '11:00', NULL, NULL)",
      ),
    ).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT id FROM time_slots WHERE id = 'duplicate'").get()).toBeUndefined();
  });

  it("keeps unscoped rows unique when the default sheet is deleted", () => {
    db.exec("UPDATE roster_sheets SET deleted_at = 'deleted' WHERE id = 'default:event'");
    migrate();
    db.exec("INSERT INTO time_slots VALUES ('legacy', 'event', 1, '10:00', '11:00', NULL, NULL)");
    expect(db.prepare("SELECT roster_sheet_id FROM time_slots WHERE id = 'legacy'").get()).toEqual({
      roster_sheet_id: null,
    });
    expect(() =>
      db.exec(
        "INSERT INTO time_slots VALUES ('duplicate', 'event', 1, '11:00', '12:00', NULL, NULL)",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("preserves phase SET NULL and slot child cascades", () => {
    migrate();
    db.exec("DELETE FROM phases WHERE id = 'phase'");
    expect(db.prepare("SELECT phase_id FROM time_slots WHERE id = 'slot'").get()).toEqual({
      phase_id: null,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM assignments").get()).toEqual({ count: 1 });
    db.exec("DELETE FROM time_slots WHERE id = 'slot'");
    for (const table of ["demands", "availabilities", "assignments"]) {
      expect(db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual([]);
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preserves event deletion cascades and foreign key rejection", () => {
    migrate();
    expect(() =>
      db.exec(
        "INSERT INTO time_slots VALUES ('invalid', 'event', 1, '10:00', '11:00', NULL, 'missing')",
      ),
    ).toThrow(/FOREIGN KEY/);
    db.exec("DELETE FROM events WHERE id = 'event'");
    for (const table of ["time_slots", "demands", "availabilities", "assignments"]) {
      expect(db.prepare(`SELECT * FROM ${table}`).all(), table).toEqual([]);
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
