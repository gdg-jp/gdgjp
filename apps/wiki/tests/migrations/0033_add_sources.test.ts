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
      readFileSync(new URL("../../migrations/0033_add_sources.sql", import.meta.url), "utf8"),
    );
    return db;
  }

  function applySourceMediaAndKindMigrations(db: DatabaseSync) {
    // This focused fixture starts at 0033; reproduce the source_documents part
    // of 0034 without requiring its unrelated google_drive_tokens predecessor.
    db.exec('ALTER TABLE "source_documents" ADD COLUMN "metadata" TEXT;');
    db.exec(
      readFileSync(
        new URL("../../migrations/0035_source_fetch_attempt.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0046_source_document_media_type.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(new URL("../../migrations/0047_source_kinds.sql", import.meta.url), "utf8"),
    );
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

  it("backfills Markdown filenames and the default media type without double extensions", () => {
    const db = openDb();
    db.prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)").run(
      "src-1",
      "google-doc",
      "https://docs.google.com/document/d/abc/edit",
      "Doc",
      "user-1",
    );
    db.prepare(
      `INSERT INTO source_documents
        (id, source_id, path, title, r2_key, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run("doc-1", "src-1", "index", "Example", "raw/src-1/doc-1/abc.md", "abc");
    db.prepare(
      `INSERT INTO source_documents
        (id, source_id, path, title, r2_key, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run("doc-2", "src-1", "notes.md", "Notes", "raw/src-1/doc-2/def.md", "def");

    applySourceMediaAndKindMigrations(db);

    expect(db.prepare("SELECT path, media_type FROM source_documents ORDER BY path").all()).toEqual(
      [
        { path: "index.md", media_type: "text/markdown" },
        { path: "notes.md", media_type: "text/markdown" },
      ],
    );
  });

  it("resolves canonical Markdown path collisions without losing documents", () => {
    const db = openDb();
    db.prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)").run(
      "src-1",
      "google-doc",
      "https://docs.google.com/document/d/abc/edit",
      "Doc",
      "user-1",
    );
    const insert = db.prepare(
      `INSERT INTO source_documents
        (id, source_id, path, title, r2_key, content_hash, captured_at)
       VALUES (?, 'src-1', ?, ?, ?, ?, unixepoch())`,
    );
    insert.run("doc-legacy", "index", "Legacy", "raw/legacy", "legacy");
    insert.run("doc-canonical", "index.md", "Canonical", "raw/canonical", "canonical");
    insert.run("doc-suffix", "index (2).md", "Suffix", "raw/suffix", "suffix");
    db.prepare(
      `INSERT INTO source_assets
        (id, source_document_id, path, r2_key, mime_type, byte_size, content_hash)
       VALUES ('asset-1', 'doc-legacy', 'asset.png', 'raw/asset', 'image/png', 1, 'asset')`,
    ).run();

    applySourceMediaAndKindMigrations(db);

    expect(db.prepare("SELECT id, path FROM source_documents ORDER BY id").all()).toEqual([
      { id: "doc-canonical", path: "index.md" },
      { id: "doc-legacy", path: "index (3).md" },
      { id: "doc-suffix", path: "index (2).md" },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT source_document_id FROM source_assets").all()).toEqual([
      { source_document_id: "doc-legacy" },
    ]);
    expect(() =>
      db
        .prepare(
          `INSERT INTO source_documents
            (id, source_id, path, title, r2_key, content_hash, captured_at)
           VALUES ('duplicate', 'src-1', 'index.md', 'Dup', 'raw/dup', 'dup', unixepoch())`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it("accepts the new Google Workspace kinds and backfills URLs from the old kind", () => {
    const db = openDb();
    for (const [id, url] of [
      ["sheet", "https://docs.google.com/u/0/spreadsheets/d/sheet-id/edit"],
      ["slides", "https://docs.google.com/u/0/presentation/d/slides-id/edit"],
    ]) {
      db.prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)").run(
        id,
        "google-doc",
        url,
        `Google Doc ${id}`,
        "user-1",
      );
    }

    applySourceMediaAndKindMigrations(db);

    expect(
      db.prepare("SELECT id, kind, status, fetch_attempt_id FROM sources ORDER BY id").all(),
    ).toEqual([
      { id: "sheet", kind: "google-sheet", status: "pending", fetch_attempt_id: null },
      { id: "slides", kind: "google-slides", status: "pending", fetch_attempt_id: null },
    ]);
    expect(() =>
      db
        .prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)")
        .run("invalid", "google-drawing", "https://example.com", "Invalid", "user-1"),
    ).toThrow(/CHECK/i);
  });

  it("archives legacy Chat documents and requeues a full weekly rebuild", () => {
    const db = openDb();
    db.prepare(
      "INSERT INTO sources (id, kind, url, title, added_by, status) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "chat-1",
      "google-chat-space",
      "https://chat.google.com/room/AAA",
      "Chat",
      "user-1",
      "ready",
    );
    db.prepare(
      `INSERT INTO source_documents
        (id, source_id, path, title, r2_key, content_hash, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    ).run("doc-1", "chat-1", "2026-07", "July", "raw/chat-1/july.md", "hash");

    applySourceMediaAndKindMigrations(db);
    db.exec(
      readFileSync(
        new URL("../../migrations/0048_reimport_google_chat_weekly.sql", import.meta.url),
        "utf8",
      ),
    );

    expect(db.prepare("SELECT status FROM source_documents WHERE id = 'doc-1'").get()).toEqual({
      status: "archived",
    });
    expect(
      db.prepare("SELECT status, fetch_attempt_id FROM sources WHERE id = 'chat-1'").get(),
    ).toEqual({
      status: "pending",
      fetch_attempt_id: null,
    });
  });

  it("adds conversation kind and owner-scoped external-id uniqueness", () => {
    const db = openDb();
    db.prepare("INSERT INTO sources (id, kind, url, title, added_by) VALUES (?, ?, ?, ?, ?)").run(
      "src-1",
      "text",
      "https://example.com",
      "Text",
      "user-1",
    );
    applySourceMediaAndKindMigrations(db);
    db.exec(
      readFileSync(
        new URL("../../migrations/0054_add_source_visibility.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0056_drop_sources_chapter_fk.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0057_discord_channel_source.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec(
      readFileSync(
        new URL("../../migrations/0059_conversation_source_kind.sql", import.meta.url),
        "utf8",
      ),
    );
    db.exec("INSERT INTO user (id) VALUES ('user-2');");

    db.prepare(
      `INSERT INTO sources
        (id, kind, external_id, url, title, added_by, status, visibility)
       VALUES (?, 'conversation', ?, ?, ?, ?, 'fetching', 'member')`,
    ).run("conversation-1", "same-session", "gdg-memory://same-session", "One", "user-1");
    db.prepare(
      `INSERT INTO sources
        (id, kind, external_id, url, title, added_by, status, visibility)
       VALUES (?, 'conversation', ?, ?, ?, ?, 'fetching', 'member')`,
    ).run("conversation-2", "same-session", "gdg-memory://same-session", "Two", "user-2");
    expect(() =>
      db
        .prepare(
          `INSERT INTO sources
            (id, kind, external_id, url, title, added_by, visibility)
           VALUES ('duplicate', 'conversation', 'same-session',
             'gdg-memory://same-session', 'Dup', 'user-1', 'member')`,
        )
        .run(),
    ).toThrow(/UNIQUE/i);
    expect(db.prepare("SELECT kind FROM sources WHERE id = 'conversation-1'").get()).toEqual({
      kind: "conversation",
    });
  });

  it("preflights duplicate legacy keys before rebuilding sources", () => {
    const db = openDb();
    const insert = db.prepare(
      "INSERT INTO sources (id, kind, external_id, url, title, added_by) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("src-1", "text", "same-id", "https://one.example", "One", "user-1");
    insert.run("src-2", "text", "same-id", "https://two.example", "Two", "user-1");

    expect(() =>
      db.exec(
        readFileSync(
          new URL("../../migrations/0059_conversation_source_kind.sql", import.meta.url),
          "utf8",
        ),
      ),
    ).toThrow(/UNIQUE/i);
    expect(db.prepare("SELECT id, url FROM sources ORDER BY id").all()).toEqual([
      { id: "src-1", url: "https://one.example" },
      { id: "src-2", url: "https://two.example" },
    ]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sources'").get(),
    ).toEqual({ name: "sources" });
  });
});
