import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migrations = [
  "0001_init.sql",
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
  "0007_roster_sheets_expand.sql",
  "0008_default_sheet_compat.sql",
];

function applyMigration(db: DatabaseSync, name: string) {
  db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
}

function insertEvent(db: DatabaseSync, id: string) {
  db.prepare(`INSERT INTO events
    (id, chapter_id, name, date, start_time, end_time, seed,
     apply_token, view_token, created_at, updated_at)
    VALUES (?, 1, 'DevFest', '2026-11-07', '09:00', '18:00', 42, ?, ?, 'created', 'updated')`).run(
    id,
    `apply-${id}`,
    `view-${id}`,
  );
}

function insertRevision(db: DatabaseSync, id: string, eventId: string, sheetId: string | null) {
  db.prepare(`INSERT INTO revisions
    (id, event_id, seq, label, actor, actor_id, kind, group_key,
     snapshot, metrics, created_at, roster_sheet_id)
    VALUES (?, ?, 1, '手動編集', 'Owner', 'owner', 'edit', 'owner',
      '{"v":1,"items":[{"a":"staff","s":"slot","t":"track","r":"reception","l":true}]}',
      '{"coverage":1}', 'created', ?)`).run(id, eventId, sheetId);
}

describe("sheet-scoped revision sequence migration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations) applyMigration(db, migration);
    insertEvent(db, "event");
  });

  afterEach(() => db.close());

  it("preserves scoped and unscoped rows verbatim and leaves no staging tables", () => {
    insertRevision(db, "revision", "event", "default:event");
    insertEvent(db, "deleted");
    db.exec("UPDATE events SET deleted_at = 'deleted' WHERE id = 'deleted'");
    insertRevision(db, "legacy-revision", "deleted", null);
    const before = db.prepare("SELECT * FROM revisions ORDER BY id").all();
    const tablesBefore = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all();

    applyMigration(db, "0010_revisions_sheet_sequence.sql");

    expect(db.prepare("SELECT * FROM revisions ORDER BY id").all()).toEqual(before);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    ).toEqual(tablesBefore);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db
        .prepare("PRAGMA foreign_key_list(revisions)")
        .all()
        .map((row) => row.table),
    ).toEqual(expect.arrayContaining(["events", "roster_sheets"]));
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'revisions'")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: "revisions_event_seq" },
        { name: "revisions_sheet_seq" },
        { name: "revisions_legacy_event_seq" },
      ]),
    );
  });

  it("allows independent sequences within one event and rejects duplicates within a sheet", () => {
    insertRevision(db, "main", "event", "default:event");
    applyMigration(db, "0010_revisions_sheet_sequence.sql");
    db.exec(`INSERT INTO roster_sheets
      (id, event_id, name, date, start_time, end_time, seed, created_at, updated_at)
      VALUES ('party', 'event', '懇親会', '2026-11-07', '18:00', '20:00', 42, 'created', 'updated')`);

    insertRevision(db, "party-first", "event", "party");
    expect(() => insertRevision(db, "unknown-sheet", "event", "missing-sheet")).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => insertRevision(db, "party-duplicate", "event", "party")).toThrow(/UNIQUE/);
    expect(() => insertRevision(db, "main-duplicate", "event", "default:event")).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT id, seq FROM revisions ORDER BY id").all()).toEqual([
      { id: "main", seq: 1 },
      { id: "party-first", seq: 1 },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.exec("DELETE FROM events WHERE id = 'event'");
    expect(db.prepare("SELECT * FROM revisions").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("scopes omitted legacy IDs to the default sheet and rejects a conflicting sequence", () => {
    applyMigration(db, "0010_revisions_sheet_sequence.sql");
    db.exec(`INSERT INTO revisions
      (id, event_id, seq, label, actor, kind, snapshot, metrics, created_at)
      VALUES ('legacy', 'event', 1, 'Generate', 'Owner', 'generate', '{}', '{}', 'created')`);
    expect(db.prepare("SELECT roster_sheet_id FROM revisions WHERE id = 'legacy'").get()).toEqual({
      roster_sheet_id: "default:event",
    });
    expect(() => insertRevision(db, "legacy-duplicate", "event", null)).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM revisions").get()).toEqual({ count: 1 });
  });

  it("retains NULL scope and event uniqueness when no live default sheet exists", () => {
    applyMigration(db, "0010_revisions_sheet_sequence.sql");
    insertEvent(db, "deleted-event");
    db.exec("UPDATE roster_sheets SET deleted_at = 'deleted' WHERE id = 'default:event'");
    db.exec("UPDATE events SET deleted_at = 'deleted' WHERE id = 'deleted-event'");

    insertRevision(db, "deleted-sheet", "event", null);
    insertRevision(db, "deleted-event", "deleted-event", null);
    expect(() => insertRevision(db, "duplicate", "event", null)).toThrow(/UNIQUE/);
    expect(() => insertRevision(db, "duplicate-event", "deleted-event", null)).toThrow(/UNIQUE/);
    expect(db.prepare("SELECT id, roster_sheet_id FROM revisions ORDER BY id").all()).toEqual([
      { id: "deleted-event", roster_sheet_id: null },
      { id: "deleted-sheet", roster_sheet_id: null },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
