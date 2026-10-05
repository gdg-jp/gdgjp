-- Repair legacy writes made between the additive 0007 migration and the
-- compatibility triggers introduced by 0008. Existing sheets are authoritative:
-- never overwrite their independently edited metadata or revive archived sheets.
INSERT INTO roster_sheets (
  id, event_id, name, date, start_time, end_time, step_min,
  no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
  revision_cursor, created_at, updated_at
)
SELECT 'default:' || e.id, e.id, '本編', e.date, e.start_time, e.end_time, e.step_min,
  e.no_solo_newcomer, e.max_consecutive, e.seed,
  CASE WHEN e.status = 'published' THEN 'published' ELSE 'private' END, 0,
  e.revision_cursor, e.created_at, e.updated_at
FROM events e
WHERE e.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM roster_sheets s WHERE s.id = 'default:' || e.id);

UPDATE phases SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);
UPDATE time_slots SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);
UPDATE tracks SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);
UPDATE demands SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);
UPDATE assignments SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);
UPDATE revisions SET roster_sheet_id = 'default:' || event_id
WHERE roster_sheet_id IS NULL AND event_id IN (
  SELECT e.id FROM events e JOIN roster_sheets s ON s.id = 'default:' || e.id
  WHERE e.deleted_at IS NULL AND s.event_id = e.id AND s.deleted_at IS NULL
);

INSERT OR IGNORE INTO roster_sheet_roles (roster_sheet_id, role_id)
SELECT s.id, r.role_id FROM event_roles r
JOIN events e ON e.id = r.event_id
JOIN roster_sheets s ON s.id = 'default:' || e.id AND s.event_id = e.id
WHERE e.deleted_at IS NULL AND s.deleted_at IS NULL;

DROP TRIGGER events_sync_default_roster_sheet;

-- An old writer may update several event columns at once. Only copy fields
-- whose values actually changed, preserving newer sheet-side edits elsewhere.
CREATE TRIGGER events_sync_default_roster_sheet
AFTER UPDATE OF date, start_time, end_time, step_min, no_solo_newcomer,
  max_consecutive, seed ON events
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE roster_sheets
  SET date = CASE WHEN NEW.date IS NOT OLD.date THEN NEW.date ELSE date END,
      start_time = CASE WHEN NEW.start_time IS NOT OLD.start_time THEN NEW.start_time ELSE start_time END,
      end_time = CASE WHEN NEW.end_time IS NOT OLD.end_time THEN NEW.end_time ELSE end_time END,
      step_min = CASE WHEN NEW.step_min IS NOT OLD.step_min THEN NEW.step_min ELSE step_min END,
      no_solo_newcomer = CASE WHEN NEW.no_solo_newcomer IS NOT OLD.no_solo_newcomer THEN NEW.no_solo_newcomer ELSE no_solo_newcomer END,
      max_consecutive = CASE WHEN NEW.max_consecutive IS NOT OLD.max_consecutive THEN NEW.max_consecutive ELSE max_consecutive END,
      seed = CASE WHEN NEW.seed IS NOT OLD.seed THEN NEW.seed ELSE seed END,
      updated_at = NEW.updated_at
  WHERE id = 'default:' || NEW.id AND event_id = NEW.id AND deleted_at IS NULL;
END;

-- A merged history entry can retain the event's cursor value while releasing
-- the sheet's temporary -1 claim, so this must run even when OLD = NEW.
CREATE TRIGGER events_sync_default_roster_sheet_cursor
AFTER UPDATE OF revision_cursor ON events
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE roster_sheets SET revision_cursor = NEW.revision_cursor
  WHERE id = 'default:' || NEW.id AND event_id = NEW.id AND deleted_at IS NULL;
END;

CREATE TRIGGER events_sync_default_roster_sheet_visibility
AFTER UPDATE OF status ON events
WHEN NEW.deleted_at IS NULL AND NEW.status IS NOT OLD.status
BEGIN
  UPDATE roster_sheets
  SET visibility = CASE WHEN NEW.status = 'published' THEN 'published' ELSE 'private' END,
      updated_at = NEW.updated_at
  WHERE id = 'default:' || NEW.id AND event_id = NEW.id AND deleted_at IS NULL;
END;
