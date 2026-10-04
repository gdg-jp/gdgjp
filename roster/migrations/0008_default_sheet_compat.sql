-- Keep legacy event-scoped writers working while the application is moved
-- onto roster_sheet_id. The default sheet is deterministic per event so
-- inserts performed by older workers can be attributed without changing
-- their SQL.

CREATE TRIGGER events_create_default_roster_sheet
AFTER INSERT ON events
BEGIN
  INSERT OR IGNORE INTO roster_sheets (
    id, event_id, name, date, start_time, end_time, step_min,
    no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
    revision_cursor, created_at, updated_at, deleted_at
  ) VALUES (
    'default:' || NEW.id, NEW.id, '本編', NEW.date, NEW.start_time, NEW.end_time,
    NEW.step_min, NEW.no_solo_newcomer, NEW.max_consecutive, NEW.seed,
    CASE WHEN NEW.status = 'published' THEN 'published' ELSE 'private' END,
    0, NEW.revision_cursor, NEW.created_at, NEW.updated_at, NEW.deleted_at
  );
END;

CREATE TRIGGER events_sync_default_roster_sheet
AFTER UPDATE OF date, start_time, end_time, step_min, no_solo_newcomer,
  max_consecutive, seed, revision_cursor, status ON events
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE roster_sheets
  SET date = NEW.date,
      start_time = NEW.start_time,
      end_time = NEW.end_time,
      step_min = NEW.step_min,
      no_solo_newcomer = NEW.no_solo_newcomer,
      max_consecutive = NEW.max_consecutive,
      seed = NEW.seed,
      revision_cursor = NEW.revision_cursor,
      visibility = CASE WHEN NEW.status = 'published' THEN 'published' ELSE 'private' END,
      updated_at = NEW.updated_at
  WHERE id = 'default:' || NEW.id
    AND event_id = NEW.id
    AND deleted_at IS NULL;
END;

-- Soft-deleting an event also hides its compatibility sheet. Clearing the
-- event's deleted_at later deliberately does not undelete the sheet.
CREATE TRIGGER events_soft_delete_default_roster_sheet
AFTER UPDATE OF deleted_at ON events
WHEN NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE roster_sheets
  SET deleted_at = COALESCE(deleted_at, NEW.deleted_at)
  WHERE id = 'default:' || NEW.id
    AND event_id = NEW.id;
END;

-- Existing route code still writes event_roles. Keep only the default sheet's
-- role set mirrored; additional sheets are managed independently.
CREATE TRIGGER event_roles_add_default_roster_sheet_role
AFTER INSERT ON event_roles
BEGIN
  INSERT OR IGNORE INTO roster_sheet_roles (roster_sheet_id, role_id)
  SELECT sheet.id, NEW.role_id
  FROM roster_sheets AS sheet
  JOIN events AS event ON event.id = sheet.event_id
  WHERE sheet.id = 'default:' || NEW.event_id
    AND sheet.event_id = NEW.event_id
    AND sheet.deleted_at IS NULL
    AND event.deleted_at IS NULL;
END;

CREATE TRIGGER event_roles_remove_default_roster_sheet_role
AFTER DELETE ON event_roles
BEGIN
  DELETE FROM roster_sheet_roles
  WHERE roster_sheet_id = 'default:' || OLD.event_id
    AND role_id = OLD.role_id
    AND EXISTS (
      SELECT 1 FROM roster_sheets AS sheet
      WHERE sheet.id = roster_sheet_roles.roster_sheet_id
        AND sheet.event_id = OLD.event_id
    );
END;

CREATE TRIGGER event_roles_update_default_roster_sheet_role
AFTER UPDATE OF event_id, role_id ON event_roles
BEGIN
  DELETE FROM roster_sheet_roles
  WHERE roster_sheet_id = 'default:' || OLD.event_id
    AND role_id = OLD.role_id;
  INSERT OR IGNORE INTO roster_sheet_roles (roster_sheet_id, role_id)
  SELECT sheet.id, NEW.role_id
  FROM roster_sheets AS sheet
  JOIN events AS event ON event.id = sheet.event_id
  WHERE sheet.id = 'default:' || NEW.event_id
    AND sheet.event_id = NEW.event_id
    AND sheet.deleted_at IS NULL
    AND event.deleted_at IS NULL;
END;

-- Legacy child inserts can omit the nullable scope column added by 0007.
-- Do not assign rows to deleted sheets or revive them; when there is no live
-- default sheet the row remains unscoped for later reconciliation.
CREATE TRIGGER phases_scope_legacy_insert
AFTER INSERT ON phases
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE phases
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

CREATE TRIGGER time_slots_scope_legacy_insert
AFTER INSERT ON time_slots
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE time_slots
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

CREATE TRIGGER tracks_scope_legacy_insert
AFTER INSERT ON tracks
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE tracks
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

CREATE TRIGGER demands_scope_legacy_insert
AFTER INSERT ON demands
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE demands
  SET roster_sheet_id = (
    SELECT sheet.id
    FROM roster_sheets AS sheet
    JOIN events AS event ON event.id = sheet.event_id
    WHERE sheet.id = 'default:' || NEW.event_id
      AND sheet.event_id = NEW.event_id
      AND sheet.deleted_at IS NULL
      AND event.deleted_at IS NULL
  )
  WHERE time_slot_id = NEW.time_slot_id
    AND track_id = NEW.track_id
    AND role_id = NEW.role_id
    AND roster_sheet_id IS NULL;
END;

CREATE TRIGGER assignments_scope_legacy_insert
AFTER INSERT ON assignments
WHEN NEW.roster_sheet_id IS NULL
BEGIN
  UPDATE assignments
  SET roster_sheet_id = (
    SELECT sheet.id
    FROM roster_sheets AS sheet
    JOIN events AS event ON event.id = sheet.event_id
    WHERE sheet.id = 'default:' || NEW.event_id
      AND sheet.event_id = NEW.event_id
      AND sheet.deleted_at IS NULL
      AND event.deleted_at IS NULL
  )
  WHERE application_id = NEW.application_id
    AND time_slot_id = NEW.time_slot_id
    AND roster_sheet_id IS NULL;
END;

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
