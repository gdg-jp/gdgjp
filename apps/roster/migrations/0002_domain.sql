-- Stage 02 domain schema: events, phases, time_slots, tracks, roles,
-- event_roles. See docs/roster/index.md §4 ("ドメインモデル") and
-- docs/roster/02-domain-schema.md "1. マイグレーション" for the design this
-- follows.
--
-- Deviation from docs/roster/02-domain-schema.md's literal SQL: `chapter_id`
-- is INTEGER here, not TEXT as written there. gdg-lib's chapter claims
-- (`UserChapter.chapterId`, gdg-lib/src/auth/index.ts) are numbers,
-- `ost/migrations/0001_init.sql` (the workspace this app was scaffolded
-- from, ADR-001) already stores `chapter_id INTEGER`, and
-- `roster/app/features/auth/permissions.ts`'s `PermissionEvent.chapterId`
-- was typed `number` in Stage 01. Storing it as TEXT would force a lossy
-- string<->number round-trip on every permission check for no benefit.

CREATE TABLE events (
  id                TEXT PRIMARY KEY,
  chapter_id        INTEGER NOT NULL,
  name              TEXT NOT NULL,
  date              TEXT NOT NULL,               -- YYYY-MM-DD
  start_time        TEXT NOT NULL CHECK (length(start_time) = 5),
  end_time          TEXT NOT NULL CHECK (length(end_time) = 5),
  step_min          INTEGER NOT NULL DEFAULT 60, -- 15 | 30 | 60
  tz                TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','open','closed','published','ended')),
  has_party         INTEGER NOT NULL DEFAULT 0,
  no_solo_newcomer  INTEGER NOT NULL DEFAULT 1,
  max_consecutive   INTEGER NOT NULL DEFAULT 4,
  seed              INTEGER NOT NULL,
  apply_token       TEXT NOT NULL UNIQUE,
  view_token        TEXT NOT NULL UNIQUE,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);

-- Reads always filter deleted_at IS NULL (scheduler/ soft-delete convention,
-- docs/roster/index.md §4); this partial index serves exactly that filter.
CREATE INDEX events_chapter_idx ON events (chapter_id) WHERE deleted_at IS NULL;

CREATE TABLE phases (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  from_time  TEXT NOT NULL,
  to_time    TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE INDEX phases_event_idx ON phases (event_id);

-- `idx` is 0-based and contiguous per event — the solver's "previous slot"
-- check and the public view's contiguous-range grouping both depend on this
-- (docs/roster/index.md §4, docs/roster/02-domain-schema.md "Design" §1).
-- Column is named `idx`, not `index`, because the latter is a near-reserved
-- word in SQL.
CREATE TABLE time_slots (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  phase_id   TEXT REFERENCES phases(id) ON DELETE SET NULL,
  UNIQUE (event_id, idx)
);

CREATE INDEX time_slots_event_idx ON time_slots (event_id);

CREATE TABLE tracks (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  shared     INTEGER NOT NULL DEFAULT 0,   -- the "全体" track
  sort_order INTEGER NOT NULL
);

CREATE INDEX tracks_event_idx ON tracks (event_id);

-- System-defined role master (ADR-007). No UI creates rows here — Non-Goal
-- explicitly excludes event-specific custom roles.
CREATE TABLE roles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE event_roles (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role_id  TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (event_id, role_id)
);

INSERT INTO roles (id, name, sort_order) VALUES
  ('reception', '受付', 1),
  ('guide',     '誘導', 2),
  ('mc',        '司会', 3),
  ('stream',    '配信', 4),
  ('photo',     '記録', 5),
  ('setup',     '設営', 6);
