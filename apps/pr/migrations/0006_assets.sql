-- Images (pr Stage 06): template slots → rendered PNG in R2 (IMAGES) → img.gdgs.jp on approval.
CREATE TABLE assets (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id           INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  template_id           TEXT NOT NULL,
  slots                 TEXT NOT NULL,
  layout_vars           TEXT NOT NULL DEFAULT '{}',
  skin                  TEXT NOT NULL,
  width                 INTEGER NOT NULL,
  height                INTEGER NOT NULL,
  scale                 INTEGER NOT NULL DEFAULT 2,
  r2_key                TEXT,
  r2_key_jpeg           TEXT,
  img_id                TEXT,
  img_url               TEXT,
  checks                TEXT NOT NULL DEFAULT '[]',
  status                TEXT NOT NULL DEFAULT 'rendering'
                        CHECK (status IN ('rendering','needs_approval','approved','rejected','superseded','failed')),
  error                 TEXT,
  for_draft_id          INTEGER REFERENCES drafts(id) ON DELETE SET NULL,
  for_schedule_item_id  INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  for_image_slot_id     TEXT,
  derived_from_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  job_id                TEXT,
  author                TEXT NOT NULL CHECK (author IN ('agent','human','generator')),
  playbook_version      TEXT NOT NULL,
  approved_by           TEXT,
  approved_at           INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX assets_campaign ON assets (campaign_id, status);
CREATE INDEX assets_item ON assets (for_schedule_item_id);
