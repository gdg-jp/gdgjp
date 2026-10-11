-- Event-owned custom roles (docs/roster/adr.md ADR-011, which supersedes
-- ADR-007's "no custom roles" rule in part). The six seeded rows keep
-- event_id NULL and stay shared by every event; an owner-created role has
-- event_id set and is visible only to that event's sheets and forms.
--
-- Additive only: existing role ids (`reception`, ...) and every row that
-- references them stay untouched, so demands, application skills,
-- assignments, and revision snapshots need no rewrite. Workers deployed
-- before this migration keep reading `id, name, sort_order` unchanged.
ALTER TABLE roles ADD COLUMN event_id TEXT REFERENCES events(id) ON DELETE CASCADE;

CREATE INDEX roles_event_idx ON roles (event_id, sort_order) WHERE event_id IS NOT NULL;

-- Exact-duplicate guard for concurrent creates; the app additionally rejects
-- names that collide with a seeded role or differ only by width/case.
CREATE UNIQUE INDEX roles_event_name ON roles (event_id, name) WHERE event_id IS NOT NULL;
