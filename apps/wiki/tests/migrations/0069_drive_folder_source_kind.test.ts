import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/** Apply every migration before 0069 in order, as wrangler does on a fresh database. */
function databaseBefore0069(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < "0069_")
    .sort();
  for (const file of files) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  // D1 enforces foreign keys and ignores `foreign_keys = OFF` inside migrations, so a DROP of
  // the parent cascades. Run the rebuild under the same conditions.
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const COUNTED = [
  "sources",
  "source_documents",
  "source_assets",
  "source_import_runs",
  "page_sources",
  "google_chat_sender_samples",
];

function counts(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(
    COUNTED.map((table) => [
      table,
      (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
    ]),
  );
}

describe("0069_drive_folder_source_kind migration", () => {
  let db: DatabaseSync;
  let before: Record<string, number>;
  let revisionBefore: unknown;

  beforeEach(() => {
    db = databaseBefore0069();
    db.exec(`
      INSERT INTO user (id, name, email, created_at, updated_at)
        VALUES ('u1', 'U', 'u@example.com', 0, 0);
      INSERT INTO pages (id, title_ja, slug, content_ja, author_id, last_edited_by, visibility)
        VALUES ('p1', 'ページ', 'page', '本文', 'u1', 'u1', 'member');
      INSERT INTO sources (id, kind, external_id, url, title, added_by, status, visibility,
                           config, last_integrated_at)
        VALUES ('s1', 'google-doc', 'doc-1', 'https://docs.google.com/document/d/doc-1/edit',
                'Doc', 'u1', 'fetching', 'member', NULL, 123),
               ('s2', 'google-chat-space', 'spaces/a', 'https://mail.google.com/chat', 'Chat',
                'u1', 'ready', 'organizer', '{"x":1}', NULL);
      INSERT INTO source_documents (id, source_id, path, title, r2_key, content_hash, captured_at)
        VALUES ('d1', 's1', 'index.md', 'Doc', 'k1', 'h1', 0);
      INSERT INTO source_assets (id, source_document_id, path, r2_key, mime_type, byte_size,
                                 content_hash)
        VALUES ('a1', 'd1', 'img.png', 'k2', 'image/png', 1, 'h2');
      INSERT INTO source_import_runs (id, source_id, kind, fetch_attempt_id, phase)
        VALUES ('r1', 's1', 'google-drive', 'attempt-1', 'content');
      INSERT INTO page_sources (id, page_id, url, source_id)
        VALUES ('ps1', 'p1', 'https://docs.google.com/document/d/doc-1/edit', 's1');
      INSERT INTO google_chat_sender_samples
        (id, resource_name, source_id, message_name, message_text, created_at)
        VALUES ('g1', 'users/1', 's2', 'spaces/a/messages/1', 'hi', 0);
    `);
    before = counts(db);
    revisionBefore = db.prepare("SELECT sync_revision FROM pages WHERE id = 'p1'").get();
    db.exec(readFileSync(new URL("0069_drive_folder_source_kind.sql", MIGRATIONS), "utf8"));
  });

  afterEach(() => db.close());

  it("keeps every source and child row (nothing cascades during the rebuild)", () => {
    expect(counts(db)).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT source_id FROM page_sources WHERE id = 'ps1'").get()).toEqual({
      source_id: "s1",
    });
    expect(db.prepare("SELECT config, last_integrated_at FROM sources ORDER BY id").all()).toEqual([
      { config: null, last_integrated_at: 123 },
      { config: '{"x":1}', last_integrated_at: null },
    ]);
  });

  it("does not bump page sync revisions while restoring page_sources", () => {
    expect(db.prepare("SELECT sync_revision FROM pages WHERE id = 'p1'").get()).toEqual(
      revisionBefore,
    );
    db.exec("UPDATE page_sources SET url = 'https://example.com' WHERE id = 'ps1'");
    expect(db.prepare("SELECT sync_revision FROM pages WHERE id = 'p1'").get()).not.toEqual(
      revisionBefore,
    );
  });

  it("accepts google-drive-folder and still rejects unknown kinds", () => {
    db.exec(`
      INSERT INTO sources (id, kind, external_id, url, title, added_by)
        VALUES ('s3', 'google-drive-folder', 'folder-1',
                'https://drive.google.com/drive/folders/folder-1', 'Folder', 'u1');
    `);
    expect(() =>
      db.exec(`
        INSERT INTO sources (id, kind, url, title, added_by)
          VALUES ('s4', 'google-folder', 'https://example.com', 'Bad', 'u1');
      `),
    ).toThrow(/CHECK/);
  });
});
