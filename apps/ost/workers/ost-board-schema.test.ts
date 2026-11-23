import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { ensureOstBoardSchema } from "./ost-board-schema";

function workersSqlStorage(db: DatabaseSync): SqlStorage {
  return {
    exec(query: string) {
      if (/PRAGMA\s+user_version/i.test(query)) {
        throw new Error("Workers SQLite rejects PRAGMA user_version");
      }
      db.exec(query);
    },
  } as unknown as SqlStorage;
}

it("runs on every Durable Object start without a version counter and keeps existing rows", () => {
  const db = new DatabaseSync(":memory:");
  const sql = workersSqlStorage(db);
  ensureOstBoardSchema(sql);
  db.exec("INSERT INTO topics (id, text, created_at) VALUES ('t1', 'topic', 1)");
  db.exec("INSERT INTO desks (id, x, y, sort_order, created_at) VALUES ('d1', 0, 0, 0, 1)");

  expect(() => ensureOstBoardSchema(sql)).not.toThrow();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);
  expect(tables).toEqual(["desks", "groups", "topics", "votes"]);
  expect(db.prepare("SELECT count(*) AS n FROM topics").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT count(*) AS n FROM desks").get()).toEqual({ n: 1 });
});
