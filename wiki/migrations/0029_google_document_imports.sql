-- Persistent provenance for Google Docs imported directly into the Wiki.
--
-- A document has exactly one import root. Every imported Wiki page (the
-- document root and every tab/sub-tab) has a durable source-node mapping.
-- The root node uses the application-defined source_node_id "__document_root__";
-- Google tab IDs are used for every other node.
CREATE TABLE "google_document_imports" (
  "document_id"      TEXT NOT NULL PRIMARY KEY,
  "root_page_id"     TEXT NOT NULL UNIQUE REFERENCES "pages"("id") ON DELETE CASCADE,
  "imported_by"      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status"           TEXT NOT NULL DEFAULT 'ready'
                     CHECK ("status" IN ('ready', 'syncing', 'failed')),
  "error_message"    TEXT,
  "last_imported_at" INTEGER,
  "created_at"       INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "google_document_import_nodes" (
  "document_id"           TEXT NOT NULL REFERENCES "google_document_imports"("document_id") ON DELETE CASCADE,
  "source_node_id"        TEXT NOT NULL,
  "page_id"               TEXT NOT NULL UNIQUE REFERENCES "pages"("id") ON DELETE CASCADE,
  "source_parent_node_id" TEXT,
  "source_kind"           TEXT NOT NULL CHECK ("source_kind" IN ('document', 'tab')),
  "sort_order"            INTEGER NOT NULL DEFAULT 0,
  "status"                TEXT NOT NULL DEFAULT 'active'
                           CHECK ("status" IN ('active', 'archived')),
  "created_at"            INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"            INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("document_id", "source_node_id")
);

CREATE INDEX "idx_google_document_import_nodes_document_parent"
  ON "google_document_import_nodes" ("document_id", "source_parent_node_id", "sort_order");
CREATE INDEX "idx_google_document_import_nodes_document_status"
  ON "google_document_import_nodes" ("document_id", "status");
