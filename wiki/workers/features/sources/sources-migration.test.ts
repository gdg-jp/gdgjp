import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0033_add_sources migration", () => {
  function openDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
      INSERT INTO "user" ("id") VALUES ('user-1');
    `);
    db.exec(
      readFileSync(new URL("../../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
    );
    return db;
  }

  it("enforces UNIQUE (source_id, path) on source_documents", () => {
    const db = openDb();
    db.prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)").run(
      "src-1",
      "website",
      "https://example.com",
      "Example",
      "user-1",
    );

    db.prepare(
      `INSERT INTO source_documents
        (id, source_id, path, title, r2_key, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run("doc-1", "src-1", "index", "Example", "raw/src-1/doc-1/abc.md", "abc");

    expect(() =>
      db
        .prepare(
          `INSERT INTO source_documents
            (id, source_id, path, title, r2_key, content_hash, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
        )
        .run("doc-2", "src-1", "index", "Dup", "raw/src-1/doc-2/def.md", "def"),
    ).toThrow(/UNIQUE/i);
  });
});
