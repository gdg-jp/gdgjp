-- Distinguish human-authored Wiki pages from agent-maintained pages.
-- Human pages stay visible in the Wiki app but are emitted under raw/ in clones.
ALTER TABLE "pages" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'human'
  CHECK ("origin" IN ('human', 'agent'));

CREATE INDEX "idx_pages_origin" ON "pages" ("origin");
