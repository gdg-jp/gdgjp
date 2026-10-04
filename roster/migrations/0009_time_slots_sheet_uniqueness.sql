-- Slot indexes belong to a sheet, not the whole event. Keep nullable sheet
-- scope and the legacy insert trigger until all deployed writers use sheets.
-- D1 keeps foreign keys enabled: rebuilding the parent cascades into its
-- children, so copy those rows into tables without foreign keys first.
CREATE TABLE _0009_demands AS
SELECT event_id, time_slot_id, track_id, role_id, min_count, ideal_count,
  lead_min, new_max, roster_sheet_id
FROM demands;
CREATE TABLE _0009_availabilities AS
SELECT application_id, time_slot_id, value
FROM availabilities;
CREATE TABLE _0009_assignments AS
SELECT event_id, application_id, time_slot_id, track_id, role_id, locked, roster_sheet_id
FROM assignments;

CREATE TABLE time_slots_rebuilt (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  phase_id        TEXT REFERENCES phases(id) ON DELETE SET NULL,
  roster_sheet_id TEXT REFERENCES roster_sheets(id),
  UNIQUE (roster_sheet_id, idx)
);
INSERT INTO time_slots_rebuilt
  (id, event_id, idx, start_time, end_time, phase_id, roster_sheet_id)
SELECT id, event_id, idx, start_time, end_time, phase_id, roster_sheet_id
FROM time_slots;

DROP TABLE time_slots;
ALTER TABLE time_slots_rebuilt RENAME TO time_slots;
CREATE INDEX time_slots_event_idx ON time_slots (event_id);
CREATE INDEX time_slots_sheet_idx ON time_slots (roster_sheet_id, idx);
-- Rows without a live default sheet still retain legacy index uniqueness.
CREATE UNIQUE INDEX time_slots_legacy_event_idx ON time_slots (event_id, idx)
  WHERE roster_sheet_id IS NULL;

INSERT INTO demands
  (event_id, time_slot_id, track_id, role_id, min_count, ideal_count,
   lead_min, new_max, roster_sheet_id)
SELECT event_id, time_slot_id, track_id, role_id, min_count, ideal_count,
  lead_min, new_max, roster_sheet_id FROM _0009_demands;
INSERT INTO availabilities (application_id, time_slot_id, value)
SELECT application_id, time_slot_id, value FROM _0009_availabilities;
INSERT INTO assignments
  (event_id, application_id, time_slot_id, track_id, role_id, locked, roster_sheet_id)
SELECT event_id, application_id, time_slot_id, track_id, role_id, locked, roster_sheet_id
FROM _0009_assignments;

-- Compatibility INSERT triggers may scope pre-existing NULL child rows.
-- Restore their exact stored scope; this migration only changes slot indexes.
UPDATE demands SET roster_sheet_id = NULL
WHERE EXISTS (
  SELECT 1 FROM _0009_demands AS backup
  WHERE backup.time_slot_id = demands.time_slot_id
    AND backup.track_id = demands.track_id
    AND backup.role_id = demands.role_id
    AND backup.roster_sheet_id IS NULL
);
UPDATE assignments SET roster_sheet_id = NULL
WHERE EXISTS (
  SELECT 1 FROM _0009_assignments AS backup
  WHERE backup.application_id = assignments.application_id
    AND backup.time_slot_id = assignments.time_slot_id
    AND backup.roster_sheet_id IS NULL
);

DROP TABLE _0009_demands;
DROP TABLE _0009_availabilities;
DROP TABLE _0009_assignments;

-- DROP TABLE removed the original trigger from 0008.
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
