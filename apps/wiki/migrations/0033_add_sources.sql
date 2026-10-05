-- Raw sources layer (LLM Wiki pattern). Primary material lives here — not in pages.
-- Wiki pages remain LLM-authored synthesis only.

CREATE TABLE "sources" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "kind"             TEXT NOT NULL
                     CHECK ("kind" IN (
                       'google-doc',
                       'google-chat-space',
                       'website',
                       'upload',
                       'text'
                     )),
  "external_id"      TEXT,
  "url"              TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "chapter_id"       TEXT REFERENCES "chapters"("id") ON DELETE SET NULL,
  "added_by"         TEXT NOT NULL REFERENCES "user"("id"),
  "status"           TEXT NOT NULL DEFAULT 'pending'
                     CHECK ("status" IN (
                       'pending',
                       'fetching',
                       'ready',
                       'error',
                       'archived'
                     )),
  "refresh_policy"   TEXT NOT NULL DEFAULT 'manual'
                     CHECK ("refresh_policy" IN ('manual', 'daily', 'weekly')),
  "last_fetched_at"  INTEGER,
  "error_message"    TEXT,
  "created_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX "idx_sources_status" ON "sources" ("status");
CREATE INDEX "idx_sources_chapter_id" ON "sources" ("chapter_id");
CREATE INDEX "idx_sources_added_by" ON "sources" ("added_by");
CREATE INDEX "idx_sources_refresh_policy" ON "sources" ("refresh_policy", "status");

CREATE TABLE "source_documents" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "source_id"   TEXT NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "path"        TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "r2_key"      TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "captured_at" INTEGER NOT NULL,
  "cursor"      TEXT,
  "status"      TEXT NOT NULL DEFAULT 'ready'
                CHECK ("status" IN ('ready', 'error', 'archived')),
  UNIQUE ("source_id", "path")
);

CREATE INDEX "idx_source_documents_source_id" ON "source_documents" ("source_id");

CREATE TABLE "source_assets" (
  "id"                 TEXT NOT NULL PRIMARY KEY,
  "source_document_id" TEXT NOT NULL REFERENCES "source_documents"("id") ON DELETE CASCADE,
  "path"               TEXT NOT NULL,
  "r2_key"             TEXT NOT NULL,
  "mime_type"          TEXT NOT NULL,
  "byte_size"          INTEGER NOT NULL,
  "content_hash"       TEXT NOT NULL
);

CREATE INDEX "idx_source_assets_source_document_id"
  ON "source_assets" ("source_document_id");
