-- Server-side record of which source documents (and wiki-human raw entries)
-- have been ingested, so operators on different machines do not duplicate work.
CREATE TABLE "source_document_ingestions" (
  "document_id"  TEXT NOT NULL PRIMARY KEY,
  "content_hash" TEXT NOT NULL,
  "ingested_at"  INTEGER NOT NULL DEFAULT (unixepoch()),
  "ingested_by"  TEXT NOT NULL REFERENCES "user"("id")
);

CREATE INDEX "idx_source_document_ingestions_hash"
  ON "source_document_ingestions" ("content_hash");
