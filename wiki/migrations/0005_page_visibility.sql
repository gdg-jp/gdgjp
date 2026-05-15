ALTER TABLE pages ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
ALTER TABLE pages ADD COLUMN chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL;
CREATE INDEX idx_pages_visibility ON pages(visibility);
CREATE INDEX idx_pages_chapter_id ON pages(chapter_id);
