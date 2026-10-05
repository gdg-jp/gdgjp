import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0029_google_document_imports migration", () => {
  it("maps each document source node to one Wiki page and retains archived nodes", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (id TEXT PRIMARY KEY);
      CREATE TABLE pages (id TEXT PRIMARY KEY);
    `);
    db.exec(
      readFileSync(
        new URL("../../migrations/0029_google_document_imports.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec("INSERT INTO user (id) VALUES ('author')");
    db.exec("INSERT INTO pages (id) VALUES ('root'), ('tab-1'), ('tab-2')");
    db.exec(
      "INSERT INTO google_document_imports (document_id, root_page_id, imported_by) VALUES ('doc', 'root', 'author')",
    );
    db.exec(`
      INSERT INTO google_document_import_nodes
        (document_id, source_node_id, page_id, source_parent_node_id, source_kind, sort_order, status)
      VALUES
        ('doc', '__document_root__', 'root', NULL, 'document', 0, 'active'),
        ('doc', 'tab-a', 'tab-1', '__document_root__', 'tab', 0, 'active'),
        ('doc', 'tab-b', 'tab-2', 'tab-a', 'tab', 1, 'archived');
    `);

    expect(
      db
        .prepare(
          "SELECT source_node_id, source_parent_node_id, status FROM google_document_import_nodes WHERE document_id = 'doc' ORDER BY source_node_id",
        )
        .all(),
    ).toEqual([
      { source_node_id: "__document_root__", source_parent_node_id: null, status: "active" },
      { source_node_id: "tab-a", source_parent_node_id: "__document_root__", status: "active" },
      { source_node_id: "tab-b", source_parent_node_id: "tab-a", status: "archived" },
    ]);
    expect(() =>
      db.exec(
        "INSERT INTO google_document_import_nodes (document_id, source_node_id, page_id, source_kind) VALUES ('doc', 'tab-c', 'tab-1', 'tab')",
      ),
    ).toThrow();
  });
});
