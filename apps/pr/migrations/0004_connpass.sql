-- connpass (pr Stage 04): every job pr submitted to the connpass app, followed by the hourly cron
-- as the person who submitted it (actor_snapshot), until it succeeds or fails.
CREATE TABLE connpass_jobs (
  job_id           TEXT PRIMARY KEY,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  target_id        INTEGER REFERENCES dispatch_targets(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('update_event','publish_event','upload_event_image','upsert_survey','send_event_message','create_sub_event')),
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  actor_snapshot   TEXT NOT NULL,
  error            TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at      INTEGER
);
CREATE INDEX connpass_jobs_open ON connpass_jobs (status, created_at);
CREATE INDEX connpass_jobs_campaign ON connpass_jobs (campaign_id, created_at);
