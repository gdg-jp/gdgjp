-- Delivery (pr Stage 03): accounts per chapter, per-account dispatch with its own approval,
-- short links, Discord settings, request follow-ups, and the actors cron calls act for.

CREATE TABLE campaign_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('x','ig','connpass_group')),
  chapter_id  INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  label       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'mirror' CHECK (role IN ('primary','mirror')),
  UNIQUE (campaign_id, kind, external_id)
);

-- One schedule item × one account. Each target is approved by a member of the account's chapter.
CREATE TABLE dispatch_targets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_item_id INTEGER NOT NULL REFERENCES schedule_items(id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES campaign_accounts(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','dispatching','scheduled','done','failed','skipped','delegated')),
  approved_by      TEXT,
  approved_at      INTEGER,
  actor_snapshot   TEXT,
  external_ref     TEXT,
  error            TEXT,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (schedule_item_id, account_id)
);

CREATE TABLE chapter_settings (
  chapter_id             INTEGER PRIMARY KEY,
  discord_webhook_cipher TEXT,
  updated_by             TEXT NOT NULL,
  updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE campaign_channels (
  campaign_id        INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  channel            TEXT NOT NULL,
  tinyurl_channel_id INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, channel)
);

CREATE TABLE campaign_links (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  tinyurl_link_id  TEXT NOT NULL,
  short_url        TEXT NOT NULL,
  slug             TEXT NOT NULL,
  destination_url  TEXT NOT NULL,
  channel          TEXT,
  og_image_url     TEXT,
  health_failures  INTEGER NOT NULL DEFAULT 0,
  health_checked_at INTEGER,
  health_alerted_at INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (schedule_item_id)
);

CREATE TABLE dispatch_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  schedule_item_id INTEGER REFERENCES schedule_items(id) ON DELETE SET NULL,
  action           TEXT NOT NULL,
  ok               INTEGER NOT NULL,
  detail           TEXT,
  at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX dispatch_log_campaign ON dispatch_log (campaign_id, at);

ALTER TABLE campaigns ADD COLUMN auto_staff_reminders INTEGER NOT NULL DEFAULT 0;
-- { user, chapters } of whoever last activated the campaign: tinyurl calls from cron act for them.
ALTER TABLE campaigns ADD COLUMN actor_snapshot TEXT;
-- Sent Discord notifications (review requests, follow-ups) so a cron run never sends one twice.
CREATE TABLE notifications_sent (
  key     TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- The live claims ({ user, chapters }) a member last had on a campaign page: the permission
-- precheck asks sns whether each member could post, before the day of a post.
ALTER TABLE campaign_members ADD COLUMN claims_snapshot TEXT;
-- An image a person attached for delivery (URL); sent to sns with the post. Stage 06 generates them.
ALTER TABLE drafts ADD COLUMN dispatch_media_url TEXT;
