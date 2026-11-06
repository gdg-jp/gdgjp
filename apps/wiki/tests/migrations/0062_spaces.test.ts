import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/** Apply every migration before 0062 in order, as wrangler does on a fresh database. */
function databaseBefore0062(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < "0062_")
    .sort();
  for (const file of files) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const COUNTED = ["pages", "page_tags", "page_access", "page_versions", "page_views", "sources"];

describe("0062_spaces migration", () => {
  let db: DatabaseSync;
  let before: Record<string, number>;

  beforeEach(() => {
    db = databaseBefore0062();
    db.exec(`
      INSERT INTO user (id, name, email, created_at, updated_at)
        VALUES ('u1', 'U', 'u@example.com', 0, 0);
      INSERT INTO tags (slug, label_ja, label_en, color) VALUES ('t', 't', 't', '#000');
      INSERT INTO pages (id, title_ja, slug, content_ja, author_id, last_edited_by, visibility)
        VALUES ('p1', '親', 'parent', '本文', 'u1', 'u1', 'restricted'),
               ('p2', '子', 'child', '本文', 'u1', 'u1', 'member');
      UPDATE pages SET parent_id = 'p1' WHERE id = 'p2';
      INSERT INTO page_tags (page_id, tag_slug) VALUES ('p1', 't');
      INSERT INTO page_access (id, page_id, subject_type, subject_key, subject_label, role, granted_by)
        VALUES ('a1', 'p1', 'email', 'x@example.com', 'x', 'viewer', 'u1');
      INSERT INTO page_versions (id, page_id, content_ja, content_en, title_ja, title_en, edited_by)
        VALUES ('v1', 'p1', '旧', '', '旧', '', 'u1');
      INSERT INTO page_views (user_id, page_id) VALUES ('u1', 'p1');
      INSERT INTO sources (id, kind, url, title, added_by, visibility)
        VALUES ('s1', 'website', 'https://example.com', 'Example', 'u1', 'organizer');
    `);
    before = Object.fromEntries(
      COUNTED.map((table) => [
        table,
        (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
      ]),
    );
    db.exec(readFileSync(new URL("0062_spaces.sql", MIGRATIONS), "utf8"));
  });

  afterEach(() => db.close());

  it("keeps every page and child row (nothing cascades during the rebuild)", () => {
    for (const table of COUNTED) {
      expect(
        (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
        table,
      ).toBe(before[table]);
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT parent_id FROM pages WHERE id = 'p2'").get()).toEqual({
      parent_id: "p1",
    });
  });

  it("puts every page and source in gdg-jp with the v1 population", () => {
    expect(db.prepare("SELECT DISTINCT space_id FROM pages").all()).toEqual([
      { space_id: "gdg-jp" },
    ]);
    expect(db.prepare("SELECT DISTINCT space_id FROM sources").all()).toEqual([
      { space_id: "gdg-jp" },
    ]);
    expect(
      db.prepare("SELECT principal_type, principal_id, role FROM space_members ORDER BY 1").all(),
    ).toEqual([
      { principal_type: "public", principal_id: "*", role: "viewer" },
      { principal_type: "user", principal_id: "*", role: "editor" },
    ]);
  });

  it("makes slugs unique per space, not globally", () => {
    db.exec("INSERT INTO spaces (id, slug, name, kind) VALUES ('team', 'team', 'Team', 'shared')");
    db.exec(`INSERT INTO pages (id, space_id, title_ja, slug, content_ja, author_id, last_edited_by)
             VALUES ('p3', 'team', '親', 'parent', '', 'u1', 'u1')`);
    expect(() =>
      db.exec(`INSERT INTO pages (id, space_id, title_ja, slug, content_ja, author_id, last_edited_by)
               VALUES ('p4', 'team', '親', 'parent', '', 'u1', 'u1')`),
    ).toThrow(/UNIQUE/);
  });

  it("restores the page triggers, including child-table sync_revision bumps", () => {
    const revision = () =>
      (db.prepare("SELECT sync_revision AS r FROM pages WHERE id = 'p1'").get() as { r: number }).r;
    const start = revision();
    db.exec("DELETE FROM page_tags WHERE page_id = 'p1'");
    expect(revision()).toBe(start + 1);
    db.exec("UPDATE pages SET title_ja = '改' WHERE id = 'p1'");
    expect(revision()).toBe(start + 2);
  });

  it("requires a chapter id exactly for chapter spaces, one space per chapter", () => {
    expect(() =>
      db.exec("INSERT INTO spaces (id, slug, name, kind) VALUES ('c', 'c-x', 'C', 'chapter')"),
    ).toThrow(/CHECK/);
    db.exec(
      "INSERT INTO spaces (id, slug, name, kind, chapter_id) VALUES ('c1', 'c-1', 'C', 'chapter', 'ch1')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO spaces (id, slug, name, kind, chapter_id) VALUES ('c2', 'c-2', 'C', 'chapter', 'ch1')",
      ),
    ).toThrow(/UNIQUE/);
  });
});
