-- Track which pages have been embedded in Vectorize
CREATE TABLE IF NOT EXISTS page_embedding_status (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'indexed' | 'error'
  chunk_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  last_indexed_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Auto-insert pending status when a new page is created
CREATE TRIGGER IF NOT EXISTS trg_page_embedding_insert
AFTER INSERT ON pages
WHEN NEW.status = 'published'
BEGIN
  INSERT OR IGNORE INTO page_embedding_status (page_id, status)
  VALUES (NEW.id, 'pending');
END;

-- Mark pending when a published page is updated
CREATE TRIGGER IF NOT EXISTS trg_page_embedding_update
AFTER UPDATE ON pages
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO page_embedding_status (page_id, status, updated_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET
    status = 'pending',
    updated_at = unixepoch();
END;
