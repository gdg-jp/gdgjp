-- Stage 04 domain schema: applications, application_skills, availabilities.
-- See docs/roster/index.md §4 ("ドメインモデル") and
-- docs/roster/04-applications.md "Design" §1 for the design this follows.
--
-- Two UNIQUE indexes prevent double registration (ADR-008):
--   - (event_id, user_id), partial on `user_id IS NOT NULL` — SQLite already
--     treats NULLs as distinct in a UNIQUE index, but the partial index makes
--     that intent explicit: any number of proxy-registered (user_id NULL)
--     rows may coexist for the same event.
--   - (event_id, email) — a proxy registration and a self-registration can
--     never both exist for the same email; this is also what "claim" resolves
--     against (app/features/applications/claim.ts).

CREATE TABLE applications (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      TEXT,                        -- NULL only for a proxy registration
  email        TEXT NOT NULL,
  name         TEXT NOT NULL,
  contact      TEXT,                        -- day-of contact method (optional)
  party        TEXT NOT NULL DEFAULT 'undecided'
                 CHECK (party IN ('yes','no','undecided')),
  note         TEXT,
  withdrawn    INTEGER NOT NULL DEFAULT 0,
  updated_by   TEXT NOT NULL DEFAULT 'self' CHECK (updated_by IN ('self','owner')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE UNIQUE INDEX applications_event_user ON applications (event_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX applications_event_email ON applications (event_id, email);
CREATE INDEX applications_event_idx ON applications (event_id);

-- A role the applicant cannot take has no row here at all — there is no
-- "unable" value for `pref` (docs/roster/index.md §3 "希望度").
CREATE TABLE application_skills (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  role_id        TEXT NOT NULL REFERENCES roles(id),
  level          TEXT NOT NULL DEFAULT 'new' CHECK (level IN ('lead','exp','new')),
  pref           INTEGER NOT NULL DEFAULT 2 CHECK (pref IN (1,2)),
  PRIMARY KEY (application_id, role_id)
);

CREATE TABLE availabilities (
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  time_slot_id   TEXT NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  value          TEXT NOT NULL CHECK (value IN ('o','d','x')),
  PRIMARY KEY (application_id, time_slot_id)
);
