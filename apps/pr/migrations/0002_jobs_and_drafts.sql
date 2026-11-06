-- Runner jobs, plans, drafts with append-only versions, and reviews (pr Stage 02).

CREATE TABLE agent_jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('plan','copy','post','page','asset','analyze','review','retro','fix')),
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
CREATE INDEX agent_jobs_queue ON agent_jobs (status, priority DESC, run_after, created_at);
CREATE INDEX agent_jobs_campaign ON agent_jobs (campaign_id, type, status);

CREATE TABLE runner_status (
  host           TEXT PRIMARY KEY,
  version        TEXT,
  backend        TEXT,
  last_seen_at   INTEGER NOT NULL,
  running_job_id TEXT
);

CREATE TABLE plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  body             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','adopted','superseded')),
  job_id           TEXT,
  author           TEXT NOT NULL,
  playbook_version TEXT NOT NULL,
  check_results    TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (campaign_id, version)
);

CREATE TABLE drafts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id         INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  schedule_item_id    INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  current_version     INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'generating'
                      CHECK (status IN ('generating','drafting','in_review','needs_approval','approved','rejected','superseded')),
  assignee_user_id    TEXT,
  reviewer_user_id    TEXT,
  review_requested_at INTEGER,
  reviewed_by         TEXT,
  reviewed_at         INTEGER,
  approved_by         TEXT,
  approved_at         INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX drafts_campaign ON drafts (campaign_id, status, kind);
CREATE INDEX drafts_item ON drafts (schedule_item_id);

-- Append-only. An edit, an agent rewrite and a fix are all new rows.
CREATE TABLE draft_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id         INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  author           TEXT NOT NULL CHECK (author IN ('agent','human')),
  user_id          TEXT,
  job_id           TEXT,
  content          TEXT NOT NULL,
  playbook_version TEXT NOT NULL,
  check_results    TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (draft_id, version)
);

CREATE TABLE draft_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id    INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  decision    TEXT NOT NULL CHECK (decision IN ('approve','request_changes','reject')),
  stage       TEXT NOT NULL CHECK (stage IN ('review','approval')),
  comment     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX draft_reviews_draft ON draft_reviews (draft_id, created_at);
