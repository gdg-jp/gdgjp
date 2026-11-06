-- Knowledge platform v2 Stage 03: what the Worker has pushed into each space's AI Search
-- instance (built-in storage, Items API). One row per item; the reconciler diffs pages and
-- source documents against it to upload changes and delete what no longer exists.
CREATE TABLE "knowledge_items" (
  "space_id"     TEXT NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE,
  "item_key"     TEXT NOT NULL,
  "item_id"      TEXT,
  -- page id or source_documents id the item was built from
  "subject_type" TEXT NOT NULL CHECK ("subject_type" IN ('page', 'document')),
  "subject_id"   TEXT NOT NULL,
  -- pages.sync_revision or source_documents.content_hash (+ audience) at upload
  "version"      TEXT NOT NULL,
  "updated_at"   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY ("space_id", "item_key")
);
CREATE INDEX "idx_knowledge_items_subject" ON "knowledge_items" ("subject_type", "subject_id");
