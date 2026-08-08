-- Citation backbone: page_sources may reference a sources.id in addition to (or
-- instead of) a free-form URL. url stays NOT NULL; use '' when only source_id is set.
ALTER TABLE "page_sources" ADD COLUMN "source_id" TEXT REFERENCES "sources"("id") ON DELETE SET NULL;

CREATE INDEX "idx_page_sources_source_id" ON "page_sources" ("source_id");
