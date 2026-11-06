-- Metrics and ads (pr Stage 07). Snapshots hold aggregates only: no participant's name, email,
-- id or free text is stored in pr.
CREATE TABLE metric_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('tinyurl','connpass_stats','connpass_survey','x_ads_csv','ig_ads_csv')),
  captured_at  INTEGER NOT NULL,
  period_start INTEGER,
  period_end   INTEGER,
  payload      TEXT NOT NULL,
  imported_by  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX metric_snapshots_campaign ON metric_snapshots (campaign_id, source, captured_at);

CREATE TABLE ad_flights (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id        INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  medium             TEXT NOT NULL CHECK (medium IN ('x_ads','ig_ads','print')),
  name               TEXT NOT NULL,
  start_at           INTEGER NOT NULL,
  end_at             INTEGER NOT NULL,
  planned_yen        INTEGER NOT NULL,
  actual_yen         INTEGER,
  phases             TEXT NOT NULL DEFAULT '[]',
  overrun_alerted_at INTEGER,
  creative_asset_ids TEXT NOT NULL DEFAULT '[]',
  targeting_notes    TEXT,
  plan_version       INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX ad_flights_campaign ON ad_flights (campaign_id, medium);

ALTER TABLE chapter_settings ADD COLUMN ads_column_maps TEXT NOT NULL DEFAULT '{}';
