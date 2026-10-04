import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const beforeExpansion = [
  "0002_domain.sql",
  "0003_demands.sql",
  "0004_applications.sql",
  "0005_assignments.sql",
  "0006_revisions.sql",
];
const afterExpansion = [
  "0008_default_sheet_compat.sql",
  "0009_time_slots_sheet_uniqueness.sql",
  "0010_revisions_sheet_sequence.sql",
];
const scopedTables = ["phases", "time_slots", "tracks", "demands", "assignments", "revisions"];

function migrate(db: DatabaseSync, name: string) {
  db.exec("BEGIN");
  db.exec(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
  db.exec("COMMIT");
}

function insertEvent(db: DatabaseSync, id: string) {
  db.prepare(`INSERT INTO events
    (id, chapter_id, name, date, start_time, end_time, seed, apply_token, view_token, created_at, updated_at)
    VALUES (?, 1, 'Event', '2026-11-07', '09:00', '18:00', 1, ?, ?, 'created', 'updated')`).run(
    id,
    `apply-${id}`,
    `view-${id}`,
  );
}

function insertLegacyRows(db: DatabaseSync, eventId: string) {
  db.prepare(
    "INSERT INTO phases (id,event_id,name,from_time,to_time,sort_order) VALUES (?,?,'Main','09:00','18:00',0)",
  ).run(`phase-${eventId}`, eventId);
  db.prepare(
    "INSERT INTO time_slots (id,event_id,idx,start_time,end_time,phase_id) VALUES (?,?,0,'09:00','10:00',?)",
  ).run(`slot-${eventId}`, eventId, `phase-${eventId}`);
  db.prepare(
    "INSERT INTO tracks (id,event_id,name,color,shared,sort_order) VALUES (?,?,'Hall','#fff',0,0)",
  ).run(`track-${eventId}`, eventId);
  db.prepare(
    "INSERT INTO applications (id,event_id,email,name,created_at,updated_at) VALUES (?,?,'staff@example.com','Staff','created','updated')",
  ).run(`staff-${eventId}`, eventId);
  db.prepare(
    "INSERT INTO demands (event_id,time_slot_id,track_id,role_id,min_count,ideal_count) VALUES (?,?,?,'reception',1,2)",
  ).run(eventId, `slot-${eventId}`, `track-${eventId}`);
  db.prepare("INSERT INTO availabilities VALUES (?,?,'d')").run(
    `staff-${eventId}`,
    `slot-${eventId}`,
  );
  db.prepare(
    "INSERT INTO assignments (event_id,application_id,time_slot_id,track_id,role_id) VALUES (?,?,?,?,'reception')",
  ).run(eventId, `staff-${eventId}`, `slot-${eventId}`, `track-${eventId}`);
  db.prepare(`INSERT INTO revisions (id,event_id,seq,label,actor,kind,snapshot,metrics,created_at)
    VALUES (?,?,1,'Generate','Owner','generate','{"v":1,"items":[]}','{}','created')`).run(
    `rev-${eventId}`,
    eventId,
  );
  db.prepare("INSERT INTO event_roles VALUES (?,'reception')").run(eventId);
}

describe("default sheet compatibility repair", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (const name of beforeExpansion) migrate(db, name);
    insertEvent(db, "existing");
    migrate(db, "0007_roster_sheets_expand.sql");
    // Simulate older workers still writing after 0007 but before 0008 exists.
    insertEvent(db, "gap");
    insertEvent(db, "deleted");
    for (const id of ["existing", "gap", "deleted"]) insertLegacyRows(db, id);
    db.exec("UPDATE events SET deleted_at='deleted' WHERE id='deleted'");
    for (const name of afterExpansion) migrate(db, name);
  });
  afterEach(() => db.close());

  it("recovers missing live sheets and NULL scopes while preserving every legacy row", () => {
    const tables = [...scopedTables, "events", "applications", "availabilities", "event_roles"];
    const before = tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    expect(db.prepare("SELECT id FROM roster_sheets WHERE event_id='gap'").get()).toBeUndefined();
    migrate(db, "0011_repair_default_sheet_compat.sql");
    expect(
      db.prepare("SELECT name, date, seed FROM roster_sheets WHERE id='default:gap'").get(),
    ).toEqual({ name: "本編", date: "2026-11-07", seed: 1 });
    for (const [index, table] of tables.entries()) {
      const after = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      expect(after).toHaveLength(before[index].length);
      for (const [rowIndex, row] of after.entries()) {
        const { roster_sheet_id: scope, ...rest } = row;
        const { roster_sheet_id: _oldScope, ...oldRest } = before[index][rowIndex];
        expect(rest).toEqual(oldRest);
        if (scopedTables.includes(table)) {
          expect(scope).toBe(row.event_id === "deleted" ? null : `default:${row.event_id}`);
        }
      }
    }
    expect(db.prepare("SELECT * FROM roster_sheet_roles ORDER BY roster_sheet_id").all()).toEqual([
      { roster_sheet_id: "default:existing", role_id: "reception" },
      { roster_sheet_id: "default:gap", role_id: "reception" },
    ]);
    expect(db.prepare("SELECT id FROM roster_sheets WHERE event_id='deleted'").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("preserves independently edited fields across repair, cursor claims, and status updates", () => {
    db.exec(`UPDATE roster_sheets SET name='Edited', date='2026-11-08', start_time='10:00',
      end_time='17:00', step_min=30, no_solo_newcomer=0, max_consecutive=2, seed=77,
      revision_cursor=4 WHERE id='default:existing';
      INSERT INTO roster_sheet_roles VALUES ('default:existing','guide')`);
    const fields = "name,date,start_time,end_time,step_min,no_solo_newcomer,max_consecutive,seed";
    const edited = db
      .prepare(`SELECT ${fields} FROM roster_sheets WHERE id='default:existing'`)
      .get();
    migrate(db, "0011_repair_default_sheet_compat.sql");
    expect(
      db.prepare(`SELECT ${fields} FROM roster_sheets WHERE id='default:existing'`).get(),
    ).toEqual(edited);
    db.exec("UPDATE events SET revision_cursor=5 WHERE id='existing'");
    db.exec("UPDATE roster_sheets SET revision_cursor=-1 WHERE id='default:existing'");
    // History coalescing repeats the same cursor to release its -1 claim.
    db.exec("UPDATE events SET revision_cursor=5 WHERE id='existing'");
    expect(
      db.prepare("SELECT revision_cursor FROM roster_sheets WHERE id='default:existing'").get(),
    ).toEqual({ revision_cursor: 5 });
    for (const status of ["published", "open"]) {
      db.prepare("UPDATE events SET status=? WHERE id='existing'").run(status);
      expect(
        db.prepare(`SELECT ${fields} FROM roster_sheets WHERE id='default:existing'`).get(),
      ).toEqual(edited);
      expect(
        db
          .prepare(
            "SELECT visibility,revision_cursor FROM roster_sheets WHERE id='default:existing'",
          )
          .get(),
      ).toEqual({
        visibility: status === "published" ? "published" : "private",
        revision_cursor: 5,
      });
    }
    expect(
      db
        .prepare(
          "SELECT role_id FROM roster_sheet_roles WHERE roster_sheet_id='default:existing' ORDER BY role_id",
        )
        .all(),
    ).toEqual([{ role_id: "guide" }, { role_id: "reception" }]);
    // Legacy writers can still change one field without reverting unchanged fields.
    db.exec("UPDATE events SET date='2026-12-01', start_time='09:00', seed=1 WHERE id='existing'");
    expect(
      db.prepare(`SELECT ${fields} FROM roster_sheets WHERE id='default:existing'`).get(),
    ).toEqual({ ...edited, date: "2026-12-01" });
  });

  it("does not revive archived default sheets or attach their previously unscoped rows", () => {
    db.exec("UPDATE roster_sheets SET deleted_at='archived' WHERE id='default:existing'");
    migrate(db, "0011_repair_default_sheet_compat.sql");
    expect(
      db.prepare("SELECT deleted_at FROM roster_sheets WHERE id='default:existing'").get(),
    ).toEqual({ deleted_at: "archived" });
    for (const table of scopedTables) {
      expect(
        db.prepare(`SELECT roster_sheet_id FROM ${table} WHERE event_id='existing'`).get(),
      ).toEqual({ roster_sheet_id: null });
    }
    expect(
      db
        .prepare("SELECT role_id FROM roster_sheet_roles WHERE roster_sheet_id='default:existing'")
        .all(),
    ).toEqual([]);
  });

  it("keeps legacy event creation, child inserts, role mirroring and soft deletion working", () => {
    migrate(db, "0011_repair_default_sheet_compat.sql");
    insertEvent(db, "new");
    insertLegacyRows(db, "new");
    for (const table of scopedTables) {
      expect(db.prepare(`SELECT roster_sheet_id FROM ${table} WHERE event_id='new'`).get()).toEqual(
        { roster_sheet_id: "default:new" },
      );
    }
    expect(
      db
        .prepare("SELECT role_id FROM roster_sheet_roles WHERE roster_sheet_id='default:new'")
        .all(),
    ).toEqual([{ role_id: "reception" }]);
    db.exec("UPDATE events SET deleted_at='deleted' WHERE id='new'");
    expect(db.prepare("SELECT deleted_at FROM roster_sheets WHERE id='default:new'").get()).toEqual(
      { deleted_at: "deleted" },
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
