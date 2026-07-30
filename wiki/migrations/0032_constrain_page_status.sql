-- SQLite cannot alter a column default or add a CHECK constraint in place.
-- Rebuild pages with the two remaining lifecycle states while retaining every
-- referenced page id for child tables.
PRAGMA foreign_keys = OFF;

CREATE TABLE pages_replacement (
  id TEXT NOT NULL PRIMARY KEY,
  title_ja TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  content_ja TEXT NOT NULL,
  content_en TEXT NOT NULL DEFAULT '',
  translation_status_ja TEXT NOT NULL DEFAULT 'human',
  translation_status_en TEXT NOT NULL DEFAULT 'missing',
  summary_ja TEXT NOT NULL DEFAULT '',
  summary_en TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'archived')),
  page_type TEXT,
  page_metadata TEXT,
  ingestion_session_id TEXT REFERENCES ingestion_sessions(id) ON DELETE SET NULL,
  actionability_score INTEGER,
  author_id TEXT NOT NULL,
  last_edited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  visibility TEXT NOT NULL DEFAULT 'restricted',
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  general_role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (general_role IN ('viewer', 'commenter', 'editor')),
  sync_revision INTEGER NOT NULL DEFAULT 1
);

INSERT INTO pages_replacement
SELECT
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order,
  CASE WHEN status = 'archived' THEN 'archived' ELSE 'published' END,
  page_type, page_metadata, ingestion_session_id, actionability_score,
  author_id, last_edited_by, created_at, updated_at, visibility, chapter_id,
  general_role, sync_revision
FROM pages;

DROP TRIGGER page_tags_sync_revision_insert;
DROP TRIGGER page_tags_sync_revision_delete;
DROP TRIGGER page_sources_sync_revision_insert;
DROP TRIGGER page_sources_sync_revision_update;
DROP TRIGGER page_sources_sync_revision_delete;
DROP TRIGGER page_attachments_sync_revision_insert;
DROP TRIGGER page_attachments_sync_revision_update;
DROP TRIGGER page_attachments_sync_revision_delete;
DROP TRIGGER page_access_sync_revision_insert;
DROP TRIGGER page_access_sync_revision_update;
DROP TRIGGER page_access_sync_revision_delete;

DROP TABLE pages;
ALTER TABLE pages_replacement RENAME TO pages;

CREATE INDEX idx_pages_status_updated ON pages (status, updated_at DESC);
CREATE INDEX idx_pages_parent_order ON pages (parent_id, sort_order ASC);
CREATE INDEX idx_pages_author ON pages (author_id, updated_at DESC);
CREATE INDEX idx_pages_slug ON pages (slug);
CREATE INDEX idx_pages_visibility ON pages (visibility);
CREATE INDEX idx_pages_chapter_id ON pages (chapter_id);

CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;
CREATE TRIGGER pages_fts_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts
  SET title_ja = new.title_ja, title_en = new.title_en, summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;
CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts WHERE page_id = old.id;
END;

CREATE TRIGGER pages_fts_trigram_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts_trigram(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;
CREATE TRIGGER pages_fts_trigram_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts_trigram
  SET title_ja = new.title_ja, title_en = new.title_en, summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;
CREATE TRIGGER pages_fts_trigram_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts_trigram WHERE page_id = old.id;
END;

CREATE TRIGGER trg_page_embedding_insert
AFTER INSERT ON pages WHEN NEW.status = 'published'
BEGIN
  INSERT OR IGNORE INTO page_embedding_status (page_id, status) VALUES (NEW.id, 'pending');
END;
CREATE TRIGGER trg_page_embedding_update
AFTER UPDATE ON pages WHEN NEW.status = 'published'
BEGIN
  INSERT INTO page_embedding_status (page_id, status, updated_at)
  VALUES (NEW.id, 'pending', unixepoch())
  ON CONFLICT(page_id) DO UPDATE SET status = 'pending', updated_at = unixepoch();
END;

CREATE TRIGGER pages_sync_revision_update
AFTER UPDATE ON pages WHEN NEW.sync_revision = OLD.sync_revision
BEGIN
  UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER page_tags_sync_revision_insert AFTER INSERT ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_tags_sync_revision_delete AFTER DELETE ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_sources_sync_revision_insert AFTER INSERT ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_update AFTER UPDATE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_sources_sync_revision_delete AFTER DELETE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_insert AFTER INSERT ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_update AFTER UPDATE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_attachments_sync_revision_delete AFTER DELETE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
CREATE TRIGGER page_access_sync_revision_insert AFTER INSERT ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_access_sync_revision_update AFTER UPDATE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER page_access_sync_revision_delete AFTER DELETE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;

PRAGMA foreign_keys = ON;
