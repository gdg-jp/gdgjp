CREATE TABLE IF NOT EXISTS sns_contributors (
  chapter_id INTEGER NOT NULL,
  user_email TEXT NOT NULL COLLATE NOCASE,
  granted_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chapter_id, user_email)
);

CREATE TABLE IF NOT EXISTS x_accounts (
  id TEXT PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  x_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  profile_image_url TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  access_token_expires_at TEXT,
  authorized_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (chapter_id, x_user_id)
);
CREATE INDEX IF NOT EXISTS x_accounts_chapter_active ON x_accounts(chapter_id, revoked_at);

CREATE TABLE IF NOT EXISTS oauth_transactions (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('x', 'google_photos')),
  user_id TEXT NOT NULL,
  chapter_id INTEGER,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_photos_tokens (
  user_id TEXT PRIMARY KEY,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_picker_sessions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  google_session_id TEXT NOT NULL,
  picker_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  x_account_id TEXT NOT NULL REFERENCES x_accounts(id),
  text TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  condition TEXT NOT NULL CHECK (condition IN ('scheduled', 'photo_required')),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'waiting_for_photo', 'posting', 'published', 'failed', 'needs_confirmation')),
  created_by_user_id TEXT NOT NULL,
  published_x_post_id TEXT,
  published_at TEXT,
  failure_reason TEXT,
  link_preview_url TEXT,
  link_preview_title TEXT,
  link_preview_description TEXT,
  link_preview_image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_due ON posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS posts_chapter_schedule ON posts(chapter_id, scheduled_at);

CREATE TABLE IF NOT EXISTS post_media (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
  created_at TEXT NOT NULL,
  UNIQUE (post_id, sort_order)
);

CREATE TABLE IF NOT EXISTS post_media_tags (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  x_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (post_id, x_user_id)
);

CREATE TABLE IF NOT EXISTS post_attempts (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('published', 'failed', 'unknown')),
  detail TEXT
);
