-- Additive expansion only: legacy readers/writers keep using event_id.
-- A later migration must reconcile writes made during this transition and
-- replace time_slots' UNIQUE(event_id, idx) and revisions' UNIQUE(event_id, seq)
-- before additional sheets can own slots or independent history sequences.
CREATE TABLE roster_sheets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL CHECK (length(start_time) = 5),
  end_time TEXT NOT NULL CHECK (length(end_time) = 5),
  step_min INTEGER NOT NULL DEFAULT 60,
  no_solo_newcomer INTEGER NOT NULL DEFAULT 1,
  max_consecutive INTEGER NOT NULL DEFAULT 4,
  seed INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'published')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  revision_cursor INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX roster_sheets_event_idx ON roster_sheets (event_id, sort_order)
  WHERE deleted_at IS NULL;

-- Prefixing the complete event ID is deterministic and collision-free.
-- Include deleted events so all existing foreign-key relationships survive.
INSERT INTO roster_sheets (
  id, event_id, name, date, start_time, end_time, step_min,
  no_solo_newcomer, max_consecutive, seed, visibility, sort_order,
  revision_cursor, created_at, updated_at, deleted_at
)
SELECT 'default:' || id, id, '本編', date, start_time, end_time, step_min,
  no_solo_newcomer, max_consecutive, seed,
  CASE WHEN status = 'published' THEN 'published' ELSE 'private' END, 0,
  revision_cursor, created_at, updated_at, deleted_at
FROM events;

ALTER TABLE phases ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);
ALTER TABLE time_slots ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);
ALTER TABLE tracks ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);
ALTER TABLE demands ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);
ALTER TABLE assignments ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);
ALTER TABLE revisions ADD COLUMN roster_sheet_id TEXT REFERENCES roster_sheets(id);

UPDATE phases SET roster_sheet_id = 'default:' || event_id;
UPDATE time_slots SET roster_sheet_id = 'default:' || event_id;
UPDATE tracks SET roster_sheet_id = 'default:' || event_id;
UPDATE demands SET roster_sheet_id = 'default:' || event_id;
UPDATE assignments SET roster_sheet_id = 'default:' || event_id;
UPDATE revisions SET roster_sheet_id = 'default:' || event_id;

CREATE INDEX phases_sheet_idx ON phases (roster_sheet_id);
CREATE INDEX time_slots_sheet_idx ON time_slots (roster_sheet_id, idx);
CREATE INDEX tracks_sheet_idx ON tracks (roster_sheet_id);
CREATE INDEX demands_sheet_idx ON demands (roster_sheet_id);
CREATE INDEX assignments_sheet_idx ON assignments (roster_sheet_id);
CREATE INDEX revisions_sheet_seq ON revisions (roster_sheet_id, seq);

CREATE TABLE roster_sheet_roles (
  roster_sheet_id TEXT NOT NULL REFERENCES roster_sheets(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (roster_sheet_id, role_id)
);
INSERT INTO roster_sheet_roles (roster_sheet_id, role_id)
SELECT 'default:' || event_id, role_id FROM event_roles;
