CREATE TABLE google_oauth_state (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX google_oauth_state_expires_idx ON google_oauth_state (expires_at);

CREATE TABLE google_connection (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  email                    TEXT NOT NULL,
  google_user_id           TEXT NOT NULL,
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_nonce      TEXT NOT NULL,
  encryption_key_version   INTEGER NOT NULL,
  scope                    TEXT NOT NULL,
  connected_by_user_id     TEXT NOT NULL,
  connected_at             TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('connected', 'disconnected')),
  last_error               TEXT
);
