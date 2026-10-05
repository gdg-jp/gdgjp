-- CLI identities use the Accounts OIDC subject as their stable actor ID.
-- That ID is not the relying-party-local user.id, so ingested_by must not
-- reference the local user table.
CREATE TABLE "source_document_ingestions_new" (
  "document_id"  TEXT NOT NULL PRIMARY KEY,
  "content_hash" TEXT NOT NULL,
  "ingested_at"  INTEGER NOT NULL DEFAULT (unixepoch()),
  "ingested_by"  TEXT NOT NULL
);

INSERT INTO "source_document_ingestions_new"
  ("document_id", "content_hash", "ingested_at", "ingested_by")
SELECT "document_id", "content_hash", "ingested_at", "ingested_by"
FROM "source_document_ingestions";

DROP TABLE "source_document_ingestions";
ALTER TABLE "source_document_ingestions_new" RENAME TO "source_document_ingestions";

CREATE INDEX "idx_source_document_ingestions_hash"
  ON "source_document_ingestions" ("content_hash");
