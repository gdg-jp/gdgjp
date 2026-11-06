-- Listings on Luma / TECH PLAY / Findy Conference / Bevy (pr Stage 05), written through the
-- connpass app. Where each campaign lists: a Luma calendar id, a TECH PLAY organizer id, …
CREATE TABLE listing_targets (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL CHECK (platform IN ('luma','techplay','findy','bevy')),
  external_id TEXT NOT NULL,
  chapter_id  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (campaign_id, platform)
);

-- connpass_jobs.kind gains create_listing. Nothing references connpass_jobs, so rebuilding it
-- cannot cascade (see the D1 foreign-key note in docs).
CREATE TABLE connpass_jobs_new (
  job_id           TEXT PRIMARY KEY,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  target_id        INTEGER REFERENCES dispatch_targets(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('update_event','publish_event','upload_event_image','upsert_survey','send_event_message','create_sub_event','create_listing')),
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  actor_snapshot   TEXT NOT NULL,
  error            TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at      INTEGER
);
INSERT INTO connpass_jobs_new SELECT * FROM connpass_jobs;
DROP TABLE connpass_jobs;
ALTER TABLE connpass_jobs_new RENAME TO connpass_jobs;
CREATE INDEX connpass_jobs_open ON connpass_jobs (status, created_at);
CREATE INDEX connpass_jobs_campaign ON connpass_jobs (campaign_id, created_at);
