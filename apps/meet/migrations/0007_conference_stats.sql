ALTER TABLE conference_records ADD COLUMN expire_time TEXT;
ALTER TABLE conference_records ADD COLUMN stats_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (stats_status IN ('pending','collecting','collected','skipped','failed','expired'));
ALTER TABLE conference_records ADD COLUMN stats_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conference_records ADD COLUMN stats_collected_at TEXT;
ALTER TABLE conference_records ADD COLUMN stats_last_error TEXT;
ALTER TABLE conference_records ADD COLUMN participant_count INTEGER;      -- host account excluded
ALTER TABLE conference_records ADD COLUMN invitee_attended_count INTEGER;
ALTER TABLE conference_records ADD COLUMN peak_concurrent INTEGER;
ALTER TABLE conference_records ADD COLUMN total_attendance_seconds INTEGER;
CREATE INDEX conference_records_stats_idx ON conference_records (stats_status, end_time);

CREATE TABLE conference_participants (
  name TEXT PRIMARY KEY,                 -- conferenceRecords/<cr>/participants/<id>
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('signedin','anonymous','phone')),
  google_user TEXT,                      -- users/<id> (signedin only)
  display_name TEXT,
  is_host_account INTEGER NOT NULL DEFAULT 0,
  invitee_email_normalized TEXT,         -- set when google_user matches meeting_invitees.google_user
  earliest_start_time TEXT, latest_end_time TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX conference_participants_record_idx ON conference_participants (conference_record);

CREATE TABLE conference_participant_sessions (
  name TEXT PRIMARY KEY,
  participant TEXT NOT NULL REFERENCES conference_participants (name) ON DELETE CASCADE,
  start_time TEXT, end_time TEXT
);
CREATE INDEX conference_participant_sessions_participant_idx ON conference_participant_sessions (participant);

CREATE TABLE conference_transcript_stats (
  transcript TEXT PRIMARY KEY,           -- conferenceRecords/<cr>/transcripts/<id>
  conference_record TEXT NOT NULL REFERENCES conference_records (name) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','collected','failed','expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT, last_error TEXT
);
CREATE TABLE conference_speaker_stats (
  transcript TEXT NOT NULL REFERENCES conference_transcript_stats (transcript) ON DELETE CASCADE,
  participant TEXT NOT NULL,             -- participant resource name, no FK (participants may be collected later)
  entry_count INTEGER NOT NULL, char_count INTEGER NOT NULL, speaking_seconds INTEGER NOT NULL,
  PRIMARY KEY (transcript, participant)
);
ALTER TABLE meeting_invitees ADD COLUMN google_user TEXT;  -- users/<id> from Meet member name suffix
