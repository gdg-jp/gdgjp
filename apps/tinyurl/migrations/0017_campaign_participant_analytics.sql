CREATE TABLE campaign_participant_analytics (
  campaign_id         INTEGER PRIMARY KEY,
  connpass_event_id   TEXT NOT NULL,
  imported_by_user_id TEXT NOT NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_campaign_channels_campaign_id_unique
  ON campaign_channels(campaign_id, id);

CREATE TABLE campaign_participant_questions (
  campaign_id    INTEGER NOT NULL,
  question_id    TEXT NOT NULL,
  question_label TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, question_id),
  FOREIGN KEY (campaign_id)
    REFERENCES campaign_participant_analytics(campaign_id) ON DELETE CASCADE
);

CREATE TABLE campaign_participant_channel_mappings (
  campaign_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  answer      TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, question_id, answer),
  FOREIGN KEY (campaign_id, question_id)
    REFERENCES campaign_participant_questions(campaign_id, question_id) ON DELETE CASCADE
);

CREATE TABLE campaign_participant_mapping_channels (
  campaign_id        INTEGER NOT NULL,
  question_id        TEXT NOT NULL,
  answer             TEXT NOT NULL,
  campaign_channel_id INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, question_id, answer, campaign_channel_id),
  FOREIGN KEY (campaign_id, question_id, answer)
    REFERENCES campaign_participant_channel_mappings(campaign_id, question_id, answer)
    ON DELETE CASCADE,
  FOREIGN KEY (campaign_id, campaign_channel_id)
    REFERENCES campaign_channels(campaign_id, id) ON DELETE CASCADE
);

CREATE TABLE campaign_participants (
  campaign_id       INTEGER NOT NULL,
  participant_id    TEXT NOT NULL,
  participation_type TEXT NOT NULL,
  registered_at     TEXT,
  last_updated_at   TEXT,
  sort_order        INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, participant_id),
  FOREIGN KEY (campaign_id)
    REFERENCES campaign_participant_analytics(campaign_id) ON DELETE CASCADE
);

CREATE INDEX idx_campaign_participants_registered
  ON campaign_participants(campaign_id, registered_at);

CREATE TABLE campaign_participant_channels (
  campaign_id        INTEGER NOT NULL,
  participant_id     TEXT NOT NULL,
  campaign_channel_id INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, participant_id, campaign_channel_id),
  FOREIGN KEY (campaign_id, participant_id)
    REFERENCES campaign_participants(campaign_id, participant_id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id, campaign_channel_id)
    REFERENCES campaign_channels(campaign_id, id) ON DELETE CASCADE
);
