import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0054_add_source_visibility migration", () => {
  function openPreMigrationDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
      INSERT INTO "user" ("id") VALUES ('user-1');
      INSERT INTO "chapters" ("id") VALUES ('chapter-osaka');
    `);
    db.exec(
      readFileSync(new URL("../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0035_source_fetch_attempt.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(new URL("../../migrations/0047_source_kinds.sql", import.meta.url), "utf8"),
    );
    return db;
  }

  it("keeps every seeded row; a CHECK-violating backfill would silently drop sources", () => {
    const db = openPreMigrationDb();
    db.prepare(
      "INSERT INTO sources (id, kind, url, title, added_by, chapter_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("s1", "website", "https://example.com/1", "Chapter-scoped", "user-1", "chapter-osaka");
    db.prepare(
      "INSERT INTO sources (id, kind, url, title, added_by, chapter_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("s2", "website", "https://example.com/2", "All-chapters", "user-1", null);

    db.exec(
      readFileSync(
        new URL("../../migrations/0054_add_source_visibility.sql", import.meta.url),
        "utf8",
      ),
    );

    expect(db.prepare("SELECT id, chapter_id, visibility FROM sources ORDER BY id").all()).toEqual([
      { id: "s1", chapter_id: "chapter-osaka", visibility: "chapter-member" },
      { id: "s2", chapter_id: null, visibility: "member" },
    ]);
  });
});
