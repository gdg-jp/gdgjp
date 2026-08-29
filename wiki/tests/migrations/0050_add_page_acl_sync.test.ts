import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0050_add_page_acl_sync migration", () => {
  it("marks only children with matching ACL data as synced", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        visibility TEXT NOT NULL,
        general_role TEXT NOT NULL
      );
      CREATE TABLE page_access (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_key TEXT NOT NULL,
        role TEXT NOT NULL
      );
      INSERT INTO pages VALUES
        ('root', NULL, 'restricted', 'viewer'),
        ('matching', 'root', 'restricted', 'viewer'),
        ('different-general', 'root', 'public', 'viewer'),
        ('different-grant', 'root', 'restricted', 'viewer');
      INSERT INTO page_access VALUES
        ('parent-grant', 'root', 'email', 'member@example.com', 'editor'),
        ('matching-grant', 'matching', 'email', 'member@example.com', 'editor'),
        ('different-grant', 'different-grant', 'email', 'member@example.com', 'viewer');
    `);
    db.exec(
      readFileSync(new URL("../../migrations/0050_add_page_acl_sync.sql", import.meta.url), "utf8"),
    );

    const rows = db
      .prepare("SELECT id, acl_synced_with_parent FROM pages ORDER BY id")
      .all() as Array<{
      id: string;
      acl_synced_with_parent: number;
    }>;
    expect(Object.fromEntries(rows.map((row) => [row.id, row.acl_synced_with_parent]))).toEqual({
      "different-general": 0,
      "different-grant": 0,
      matching: 1,
      root: 1,
    });
  });
});
