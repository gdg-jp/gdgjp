-- Globally shared, Git-materialized instructions for LLM Wiki clones.
-- The Worker idempotently seeds the canonical body when this new table is
-- first read; subsequent values are managed only through the Wiki remote.
CREATE TABLE "wiki_agent_instructions" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "content" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "updated_by" TEXT NOT NULL REFERENCES "user"("id"),
  "updated_at" INTEGER NOT NULL DEFAULT (unixepoch())
);
