-- The assistant (秘書): one thread per campaign, the sources it reads, and per-chapter settings.

CREATE TABLE campaign_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  author      TEXT NOT NULL CHECK (author IN ('user', 'assistant')),
  user_id     TEXT,
  user_name   TEXT,
  body        TEXT NOT NULL DEFAULT '',
  -- [{ id, name, type, size }]: files in R2 IMAGES under assist/<campaign>/<id>
  attachments TEXT NOT NULL DEFAULT '[]',
  -- [{ type, label, …, status, result }]: buttons the assistant offers
  actions     TEXT NOT NULL DEFAULT '[]',
  questions   TEXT NOT NULL DEFAULT '[]',
  -- { briefVersion, briefChanges, errors }
  meta        TEXT NOT NULL DEFAULT '{}',
  job_id      TEXT,
  -- Messages the assistant posts on its own (plan ready, draft ready, deadline) are posted once.
  event_key   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX campaign_messages_campaign ON campaign_messages (campaign_id, id);
CREATE UNIQUE INDEX campaign_messages_event ON campaign_messages (campaign_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE TABLE campaign_sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  -- R2 key of the extracted text, and [{ id, type, size }] images saved beside it
  text_key    TEXT,
  images      TEXT NOT NULL DEFAULT '[]',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  error       TEXT,
  fetched_at  INTEGER,
  created_by  TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (campaign_id, url)
);

-- auto: the assistant queues plans and drafts itself; suggest: it only offers buttons.
ALTER TABLE chapter_settings ADD COLUMN assistant_mode TEXT NOT NULL DEFAULT 'auto';
-- A 09:00 JST Discord message with the day's schedule and what waits on people.
ALTER TABLE chapter_settings ADD COLUMN morning_digest INTEGER NOT NULL DEFAULT 1;

-- agent_jobs.type gains assist. Nothing references agent_jobs, so rebuilding it cannot cascade
-- (see the D1 foreign-key note in docs).
CREATE TABLE agent_jobs_new (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('plan','copy','post','page','asset','analyze','review','retro','fix','assist')),
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','leased','succeeded','failed','needs_review','expired')),
  priority     INTEGER NOT NULL DEFAULT 0,
  payload      TEXT NOT NULL DEFAULT '{}',
  result       TEXT,
  error        TEXT,
  lease_owner  TEXT,
  lease_until  INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  run_after    INTEGER NOT NULL DEFAULT (unixepoch()),
  requested_by TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  started_at   INTEGER,
  finished_at  INTEGER
);
INSERT INTO agent_jobs_new SELECT * FROM agent_jobs;
DROP TABLE agent_jobs;
ALTER TABLE agent_jobs_new RENAME TO agent_jobs;
CREATE INDEX agent_jobs_queue ON agent_jobs (status, priority DESC, run_after, created_at);
CREATE INDEX agent_jobs_campaign ON agent_jobs (campaign_id, type, status);
