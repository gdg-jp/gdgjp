-- Design (pr): the agent designs images in HTML (design mode) beside the slot templates; an
-- event's adopted design kit (its face) is one asset the campaign points at; chapters keep a
-- library of reference designs (people's own work) that asset jobs see.
ALTER TABLE assets ADD COLUMN purpose TEXT NOT NULL DEFAULT 'image';
ALTER TABLE assets ADD COLUMN html TEXT;
ALTER TABLE assets ADD COLUMN notes TEXT NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN kit_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL;

CREATE TABLE design_references (
  id           TEXT PRIMARY KEY,
  chapter_id   INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('thumbnail','session','speaker','post','ad','ig','print','other')),
  event        TEXT NOT NULL DEFAULT '',
  made_on      TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX design_references_chapter ON design_references (chapter_id, made_on DESC, created_at DESC);
