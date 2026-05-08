ALTER TABLE links ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private', 'public'));

CREATE INDEX idx_links_visibility ON links(visibility, deleted_at);
