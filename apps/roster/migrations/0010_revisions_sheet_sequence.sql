-- Independent sheets need independent history sequences. No table references
-- revisions, so rebuild it with foreign keys enabled and copy snapshots verbatim.
-- Keep the nullable scope and legacy insert trigger until all writers migrate.
CREATE TABLE revisions_sheet_migration (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('generate','edit','restore')),
  group_key TEXT,
  snapshot TEXT NOT NULL,
  metrics TEXT NOT NULL,
  created_at TEXT NOT NULL,
  roster_sheet_id TEXT REFERENCES roster_sheets(id),
  UNIQUE (roster_sheet_id, seq)
);

INSERT INTO revisions_sheet_migration (
  id, event_id, seq, label, actor, actor_id, kind, group_key,
  snapshot, metrics, created_at, roster_sheet_id
)
SELECT id, event_id, seq, label, actor, actor_id, kind, group_key,
  snapshot, metrics, created_at, roster_sheet_id
FROM revisions;

DROP TABLE revisions;
ALTER TABLE revisions_sheet_migration RENAME TO revisions;

CREATE INDEX revisions_event_seq ON revisions (event_id, seq);
CREATE INDEX revisions_sheet_seq ON revisions (roster_sheet_id, seq);
-- Soft-deleted events/sheets can still receive unscoped legacy writes. Preserve
-- their sequence uniqueness even when the compatibility trigger leaves NULL.
CREATE UNIQUE INDEX revisions_legacy_event_seq ON revisions (event_id, seq)
  WHERE roster_sheet_id IS NULL;

CREATE TRIGGER revisions_scope_legacy_insert
AFTER INSERT ON revisions
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE revisions
  SET roster_sheet_id = (
    SELECT sheet.id
    FROM roster_sheets AS sheet
    JOIN events AS event ON event.id = sheet.event_id
    WHERE sheet.id = 'default:' || NEW.event_id
      AND sheet.event_id = NEW.event_id
      AND sheet.deleted_at IS NULL
      AND event.deleted_at IS NULL
  )
  WHERE id = NEW.id AND roster_sheet_id IS NULL;
END;
