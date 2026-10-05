-- Revision used by the CLI mirror.  Triggers make every mutation of a page
-- or a synced child record visible to optimistic clients.
ALTER TABLE pages ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER IF NOT EXISTS pages_sync_revision_update
AFTER UPDATE ON pages
WHEN NEW.sync_revision = OLD.sync_revision
BEGIN
  UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS page_tags_sync_revision_insert AFTER INSERT ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_tags_sync_revision_delete AFTER DELETE ON page_tags
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;

CREATE TRIGGER IF NOT EXISTS page_sources_sync_revision_insert AFTER INSERT ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_sources_sync_revision_update AFTER UPDATE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_sources_sync_revision_delete AFTER DELETE ON page_sources
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;

CREATE TRIGGER IF NOT EXISTS page_attachments_sync_revision_insert AFTER INSERT ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_attachments_sync_revision_update AFTER UPDATE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_attachments_sync_revision_delete AFTER DELETE ON page_attachments
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;

CREATE TRIGGER IF NOT EXISTS page_access_sync_revision_insert AFTER INSERT ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_access_sync_revision_update AFTER UPDATE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = NEW.page_id; END;
CREATE TRIGGER IF NOT EXISTS page_access_sync_revision_delete AFTER DELETE ON page_access
BEGIN UPDATE pages SET sync_revision = sync_revision + 1 WHERE id = OLD.page_id; END;
