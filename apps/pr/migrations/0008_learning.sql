-- Learning loop (pr Stage 08): what people changed in drafts (mechanically), Playbook proposals
-- from retros, people and analyses, and the campaign's own KPT notes.
CREATE TABLE draft_edits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  draft_id      INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  asset_id      INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  from_version  INTEGER NOT NULL,
  to_version    INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  field         TEXT NOT NULL,
  before        TEXT,
  after         TEXT,
  char_distance INTEGER NOT NULL,
  rule_hints    TEXT NOT NULL DEFAULT '[]',
  user_id       TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX draft_edits_campaign ON draft_edits (campaign_id, kind, field);

CREATE TABLE playbook_proposals (
  id                       TEXT PRIMARY KEY,
  chapter_id               INTEGER NOT NULL,
  campaign_id              INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  origin                   TEXT NOT NULL CHECK (origin IN ('retro','human','analyze')),
  kind                     TEXT NOT NULL CHECK (kind IN ('rule','constant','guide','template','example','decision')),
  target                   TEXT NOT NULL,
  summary                  TEXT NOT NULL,
  observation              TEXT NOT NULL,
  evidence                 TEXT NOT NULL DEFAULT '{}',
  payload                  TEXT NOT NULL DEFAULT '{}',
  status                   TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','applied')),
  decided_by               TEXT,
  decided_at               INTEGER,
  decision_reason          TEXT,
  exported_at              INTEGER,
  applied_playbook_version TEXT,
  playbook_version         TEXT NOT NULL,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX playbook_proposals_chapter ON playbook_proposals (chapter_id, status, kind);

ALTER TABLE campaigns ADD COLUMN retro_notes_md TEXT;
