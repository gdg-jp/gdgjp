ALTER TABLE links ADD COLUMN archived_at INTEGER;

CREATE INDEX idx_links_archive
  ON links(archived_at, deleted_at, created_at DESC);
