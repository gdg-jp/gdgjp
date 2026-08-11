import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/**
 * /sources resolves chapter options from Accounts, not the local `chapters` table.
 * 0056 drops the sources.chapter_id FK so chapter-organizer / chapter-member inserts
 * succeed for Accounts ids that are missing locally.
 */
describe("0056_drop_sources_chapter_fk migration", () => {
  function openPostVisibilityDb() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "user" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "chapters" ("id" TEXT PRIMARY KEY);
      INSERT INTO "user" ("id") VALUES ('user-1');
    `);
    db.exec(
      readFileSync(new URL("../../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../../../migrations/0035_source_fetch_attempt.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(new URL("../../../migrations/0047_source_kinds.sql", import.meta.url), "utf8"),
    );
    db.exec(
      readFileSync(
        new URL("../../../migrations/0054_add_source_visibility.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec("PRAGMA foreign_keys = ON");
    return db;
  }

  it("rejects Accounts chapter ids that are missing from local chapters before 0056", () => {
    const db = openPostVisibilityDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO sources (id, kind, url, title, added_by, chapter_id, visibility)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "s1",
          "website",
          "https://example.com",
          "Scoped",
          "user-1",
          "accounts-chapter-1",
          "chapter-organizer",
        ),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("allows chapter-organizer rows for Accounts ids after dropping the FK", () => {
    const db = openPostVisibilityDb();
    db.exec(
      readFileSync(
        new URL("../../../migrations/0056_drop_sources_chapter_fk.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec("PRAGMA foreign_keys = ON");

    db.prepare(
      `INSERT INTO sources (id, kind, url, title, added_by, chapter_id, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "s1",
      "website",
      "https://example.com",
      "Scoped",
      "user-1",
      "accounts-chapter-1",
      "chapter-organizer",
    );

    expect(db.prepare("SELECT chapter_id, visibility FROM sources WHERE id = 's1'").get()).toEqual({
      chapter_id: "accounts-chapter-1",
      visibility: "chapter-organizer",
    });
    expect(db.prepare("PRAGMA foreign_key_check('sources')").all()).toEqual([]);
  });
});
