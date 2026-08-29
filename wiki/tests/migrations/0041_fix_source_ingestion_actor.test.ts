import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

describe("0041_fix_source_ingestion_actor migration", () => {
  it("preserves history and accepts an Accounts OIDC subject as the actor", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (id TEXT PRIMARY KEY);
      INSERT INTO user (id) VALUES ('local-user-id');
    `);
    db.exec(
      readFileSync(
        new URL("../../migrations/0039_source_document_ingestions.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(`
      INSERT INTO source_document_ingestions
        (document_id, content_hash, ingested_by)
      VALUES ('existing-document', 'existing-hash', 'local-user-id');
    `);

    db.exec(
      readFileSync(
        new URL("../../migrations/0041_fix_source_ingestion_actor.sql", import.meta.url),
        "utf8",
      ),
    );

    expect(db.prepare("PRAGMA foreign_key_list('source_document_ingestions')").all()).toEqual([]);
    expect(
      db
        .prepare("SELECT document_id, content_hash, ingested_by FROM source_document_ingestions")
        .all(),
    ).toEqual([
      {
        document_id: "existing-document",
        content_hash: "existing-hash",
        ingested_by: "local-user-id",
      },
    ]);

    expect(() =>
      db.exec(`
        INSERT INTO source_document_ingestions
          (document_id, content_hash, ingested_by)
        VALUES ('wiki-human:page-id', 'new-hash', 'accounts-oidc-subject');
      `),
    ).not.toThrow();
  });
});

describe("0053_drop_source_document_ingestions migration", () => {
  it("removes the obsolete server-side ingestion state", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      readFileSync(
        new URL("../../migrations/0039_source_document_ingestions.sql", import.meta.url),
        "utf8",
      ),
    );

    db.exec(
      readFileSync(
        new URL("../../migrations/0053_drop_source_document_ingestions.sql", import.meta.url),
        "utf8",
      ),
    );

    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .all("source_document_ingestions"),
    ).toEqual([]);
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .all("idx_source_document_ingestions_hash"),
    ).toEqual([]);
  });
});
