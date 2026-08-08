-- Google Chat ingestion: record OAuth scopes granted at consent, and per-document
-- metadata (extracted URLs) for Stage 3 source suggestions.

ALTER TABLE "google_drive_tokens" ADD COLUMN "granted_scopes" TEXT;

ALTER TABLE "source_documents" ADD COLUMN "metadata" TEXT;
