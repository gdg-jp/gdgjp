import { describe, expect, it } from "vitest";
import {
  assertStagingSlot,
  exportDurableObjectStorage,
  importDurableObjectStorage,
} from "./staging-snapshot";
import { FakeDurableObjectStorage } from "./testing/durable-object";

async function populated(): Promise<FakeDurableObjectStorage> {
  const storage = new FakeDurableObjectStorage();
  storage.sql.exec(`
    CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
    CREATE TABLE images (
      id INTEGER PRIMARY KEY,
      unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      body BLOB
    );
    CREATE TABLE audit (unit_id INTEGER NOT NULL);
    CREATE INDEX images_unit ON images(unit_id);
    CREATE VIEW unit_titles AS SELECT title FROM units;
    CREATE TRIGGER units_audit AFTER INSERT ON units BEGIN
      INSERT INTO audit (unit_id) VALUES (new.id);
    END;
  `);
  storage.sql.exec("INSERT INTO units (title) VALUES (?)", "first");
  storage.sql.exec("INSERT INTO units (title) VALUES (?)", 'it\'s "quoted"');
  storage.sql.exec(
    "INSERT INTO images (id, unit_id, body) VALUES (?, ?, ?)",
    7,
    2,
    new Uint8Array([1, 2, 3]).buffer,
  );
  await storage.put({
    "yjs-state": new Uint8Array([9, 8, 7]).buffer,
    room: { slots: [1, 2], since: new Date(0) },
  });
  await storage.setAlarm(1_700_000_000_000);
  return storage;
}

describe("Durable Object storage snapshots", () => {
  it("copies SQL tables, schema objects, KV values, and the alarm", async () => {
    const snapshot = structuredClone(await exportDurableObjectStorage(await populated()));
    const target = new FakeDurableObjectStorage();
    target.sql.exec("CREATE TABLE stale (id INTEGER)");
    await target.put("stale", true);
    await target.setAlarm(5);

    await importDurableObjectStorage(target, snapshot);

    expect(await exportDurableObjectStorage(target)).toEqual(snapshot);
    expect(target.sql.exec("SELECT unit_id FROM audit").toArray()).toEqual([
      { unit_id: 1 },
      { unit_id: 2 },
    ]);
    target.sql.exec("INSERT INTO units (title) VALUES ('third')");
    expect(target.sql.exec("SELECT max(id) AS id FROM units").one()).toEqual({ id: 3 });
    expect(target.sql.exec("SELECT count(*) AS n FROM audit").one()).toEqual({ n: 3 });
    expect(target.sql.exec("SELECT title FROM unit_titles ORDER BY title").toArray()).toHaveLength(
      3,
    );
    expect(await target.get("stale")).toBeUndefined();
    expect(await target.get("room")).toEqual({ slots: [1, 2], since: new Date(0) });
    expect(new Uint8Array((await target.get<ArrayBuffer>("yjs-state")) ?? [])).toEqual(
      new Uint8Array([9, 8, 7]),
    );
    expect(await target.getAlarm()).toBe(1_700_000_000_000);
  });

  it("leaves the target empty and without an alarm for an empty snapshot", async () => {
    const empty = await exportDurableObjectStorage(new FakeDurableObjectStorage());
    expect(empty).toEqual({ kv: [], tables: [], schema: [], alarm: null });
    const target = await populated();
    await importDurableObjectStorage(target, empty);
    expect(await exportDurableObjectStorage(target)).toEqual(empty);
  });

  it("restores rows whose foreign keys point at later tables", async () => {
    const source = new FakeDurableObjectStorage();
    source.sql.exec(`
      CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id));
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
    `);
    source.sql.exec("INSERT INTO parents (id) VALUES (1)");
    source.sql.exec("INSERT INTO children (id, parent_id) VALUES (1, 1)");
    const target = new FakeDurableObjectStorage();
    await importDurableObjectStorage(target, await exportDurableObjectStorage(source));
    expect(target.sql.exec("SELECT parent_id FROM children").toArray()).toEqual([{ parent_id: 1 }]);
  });

  it("rejects virtual tables instead of copying their shadow tables", async () => {
    const storage = new FakeDurableObjectStorage();
    storage.sql.exec("CREATE VIRTUAL TABLE search USING fts5(body)");
    await expect(exportDurableObjectStorage(storage)).rejects.toThrow(/Virtual table search/);
  });

  it("only allows imports when a staging slot is configured", () => {
    expect(assertStagingSlot({ STAGING_SLOT: "stg-1" })).toBe("stg-1");
    for (const STAGING_SLOT of [undefined, "", "  ", 1])
      expect(() => assertStagingSlot({ STAGING_SLOT })).toThrow(/staging slot/);
  });
});
