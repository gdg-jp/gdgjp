-- Replace legacy monthly Chat documents with Monday-date weekly documents.
-- Archiving every existing Chat document clears maxSourceCursor, so the next
-- import is a complete, deterministic rebuild rather than a delta append.
UPDATE "source_documents"
SET "status" = 'archived'
WHERE "source_id" IN (
  SELECT "id" FROM "sources" WHERE "kind" = 'google-chat-space'
);

UPDATE "sources"
SET "status" = 'pending', "fetch_attempt_id" = NULL
WHERE "kind" = 'google-chat-space' AND "status" <> 'archived';
