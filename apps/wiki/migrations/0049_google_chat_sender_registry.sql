-- Persistent manual sender-name registry for Google Chat raw sources.
CREATE TABLE "google_chat_sender_profiles" (
  "resource_name" TEXT NOT NULL PRIMARY KEY,
  "display_name" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE "google_chat_sender_samples" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resource_name" TEXT NOT NULL,
  "source_id" TEXT NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "message_name" TEXT NOT NULL,
  "message_text" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (resource_name, source_id, message_name)
);

CREATE INDEX "idx_google_chat_sender_samples_resource_created"
  ON "google_chat_sender_samples" ("resource_name", "created_at" DESC);

CREATE TABLE "google_chat_document_renders" (
  "source_document_id" TEXT NOT NULL PRIMARY KEY REFERENCES "source_documents"("id") ON DELETE CASCADE,
  "render_data" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
