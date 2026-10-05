-- Per-event admin now connects their own Google account (drive.file + spreadsheets
-- scopes) so Drive writes land in a real user's quota instead of the storage-quota-free
-- service account. See pay/app/lib/google-oauth.server.ts.
CREATE TABLE google_oauth_tokens (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_expires_at INTEGER NOT NULL,
  template_granted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE oauth_transactions (
  state TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

ALTER TABLE events ADD COLUMN google_admin_user_id TEXT REFERENCES "user"(id);
ALTER TABLE events ADD COLUMN google_drive_folder_id TEXT;
ALTER TABLE events ADD COLUMN google_drive_folder_name TEXT;

CREATE INDEX events_google_admin_user_id_idx ON events (google_admin_user_id);
