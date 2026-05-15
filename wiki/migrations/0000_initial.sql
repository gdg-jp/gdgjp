-- =============================================================================
-- Migration: 0000_initial
-- Full schema for GDGoC Japan Wiki (v0.1)
--
-- This file contains:
--   1. better-auth managed tables (user, session, account, verification)
--   2. App-defined tables (chapters, tags, ingestion_sessions, pages, etc.)
--   3. FTS5 virtual table + sync triggers
--   4. Seed data (canonical tags)
--   5. Indexes
--
-- Run with:
--   pnpm wrangler d1 execute gdgoc-wiki-production-db --remote --file=drizzle/0000_initial.sql
--
-- Note: if you change the better-auth additionalFields config, regenerate the
-- auth migration with: pnpm exec better-auth generate
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. better-auth managed tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "user" (
  "id"                        TEXT NOT NULL PRIMARY KEY,
  "name"                      TEXT NOT NULL,
  "email"                     TEXT NOT NULL UNIQUE,
  "emailVerified"             INTEGER NOT NULL DEFAULT 0,
  "image"                     TEXT,
  "createdAt"                 INTEGER NOT NULL,
  "updatedAt"                 INTEGER NOT NULL,
  -- additionalFields
  "role"                      TEXT NOT NULL DEFAULT 'member',
  "chapterId"                 TEXT,
  "preferredUiLanguage"       TEXT NOT NULL DEFAULT 'ja',
  "preferredContentLanguage"  TEXT NOT NULL DEFAULT 'ja'
);

CREATE TABLE IF NOT EXISTS "session" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "expiresAt"   INTEGER NOT NULL,
  "token"       TEXT NOT NULL UNIQUE,
  "createdAt"   INTEGER NOT NULL,
  "updatedAt"   INTEGER NOT NULL,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "userId"      TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  "id"                      TEXT NOT NULL PRIMARY KEY,
  "accountId"               TEXT NOT NULL,
  "providerId"              TEXT NOT NULL,
  "userId"                  TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken"             TEXT,
  "refreshToken"            TEXT,
  "idToken"                 TEXT,
  "accessTokenExpiresAt"    INTEGER,
  "refreshTokenExpiresAt"   INTEGER,
  "scope"                   TEXT,
  "password"                TEXT,
  "createdAt"               INTEGER NOT NULL,
  "updatedAt"               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "verification" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "identifier"  TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "expiresAt"   INTEGER NOT NULL,
  "createdAt"   INTEGER,
  "updatedAt"   INTEGER
);

-- ---------------------------------------------------------------------------
-- 2. App-defined tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "chapters" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "name_ja"     TEXT NOT NULL,
  "name_en"     TEXT NOT NULL,
  "university"  TEXT NOT NULL,
  "region"      TEXT NOT NULL,
  "created_at"  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "tags" (
  "slug"        TEXT NOT NULL PRIMARY KEY,
  "label_ja"    TEXT NOT NULL,
  "label_en"    TEXT NOT NULL,
  "color"       TEXT NOT NULL,
  "page_count"  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "ingestion_sessions" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "user_id"       TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "inputs_json"   TEXT NOT NULL,
  "ai_draft_json" TEXT,
  "error_message" TEXT,
  "created_at"    INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "pages" (
  "id"                    TEXT NOT NULL PRIMARY KEY,
  "title_ja"              TEXT NOT NULL,
  "title_en"              TEXT NOT NULL DEFAULT '',
  "slug"                  TEXT NOT NULL UNIQUE,
  "content_ja"            TEXT NOT NULL,
  "content_en"            TEXT NOT NULL DEFAULT '',
  "translation_status_ja" TEXT NOT NULL DEFAULT 'human',
  "translation_status_en" TEXT NOT NULL DEFAULT 'missing',
  "summary_ja"            TEXT NOT NULL DEFAULT '',
  "summary_en"            TEXT NOT NULL DEFAULT '',
  "parent_id"             TEXT REFERENCES "pages"("id") ON DELETE SET NULL,
  "sort_order"            INTEGER NOT NULL DEFAULT 0,
  "status"                TEXT NOT NULL DEFAULT 'draft',
  "page_type"             TEXT,
  "page_metadata"         TEXT,
  "ingestion_session_id"  TEXT REFERENCES "ingestion_sessions"("id") ON DELETE SET NULL,
  "actionability_score"   INTEGER,
  "author_id"             TEXT NOT NULL,
  "last_edited_by"        TEXT NOT NULL,
  "created_at"            INTEGER NOT NULL DEFAULT (unixepoch()),
  "updated_at"            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "page_tags" (
  "page_id"   TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "tag_slug"  TEXT NOT NULL REFERENCES "tags"("slug") ON DELETE CASCADE,
  PRIMARY KEY ("page_id", "tag_slug")
);

CREATE TABLE IF NOT EXISTS "page_attachments" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "page_id"     TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "r2_key"      TEXT NOT NULL,
  "file_name"   TEXT NOT NULL,
  "mime_type"   TEXT NOT NULL,
  "created_at"  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "page_versions" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "page_id"     TEXT NOT NULL REFERENCES "pages"("id") ON DELETE CASCADE,
  "content_ja"  TEXT NOT NULL,
  "content_en"  TEXT NOT NULL,
  "title_ja"    TEXT NOT NULL,
  "title_en"    TEXT NOT NULL,
  "edited_by"   TEXT NOT NULL,
  "saved_at"    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ---------------------------------------------------------------------------
-- 3. FTS5 virtual table + sync triggers
-- ---------------------------------------------------------------------------

CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  page_id  UNINDEXED,
  title_ja,
  title_en,
  summary_ja,
  summary_en,
  tags_text,
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(page_id, title_ja, title_en, summary_ja, summary_en, tags_text)
  VALUES (new.id, new.title_ja, new.title_en, new.summary_ja, new.summary_en, '');
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE ON pages BEGIN
  UPDATE pages_fts
  SET title_ja   = new.title_ja,
      title_en   = new.title_en,
      summary_ja = new.summary_ja,
      summary_en = new.summary_en
  WHERE page_id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
  DELETE FROM pages_fts WHERE page_id = old.id;
END;

-- Keep tags_text in sync when page_tags rows are added or removed.
-- GROUP_CONCATs both JA and EN label strings so both languages are searchable.
CREATE TRIGGER IF NOT EXISTS page_tags_fts_insert AFTER INSERT ON page_tags BEGIN
  UPDATE pages_fts
  SET tags_text = (
    SELECT COALESCE(GROUP_CONCAT(t.label_ja || ' ' || t.label_en, ' '), '')
    FROM page_tags pt
    JOIN tags t ON t.slug = pt.tag_slug
    WHERE pt.page_id = new.page_id
  )
  WHERE page_id = new.page_id;
END;

CREATE TRIGGER IF NOT EXISTS page_tags_fts_delete AFTER DELETE ON page_tags BEGIN
  UPDATE pages_fts
  SET tags_text = (
    SELECT COALESCE(GROUP_CONCAT(t.label_ja || ' ' || t.label_en, ' '), '')
    FROM page_tags pt
    JOIN tags t ON t.slug = pt.tag_slug
    WHERE pt.page_id = old.page_id
  )
  WHERE page_id = old.page_id;
END;

-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_pages_status_updated  ON pages (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_parent_order    ON pages (parent_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_pages_author          ON pages (author_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_slug            ON pages (slug);
CREATE INDEX IF NOT EXISTS idx_page_tags_page        ON page_tags (page_id);
CREATE INDEX IF NOT EXISTS idx_page_tags_tag         ON page_tags (tag_slug);
CREATE INDEX IF NOT EXISTS idx_page_versions_page    ON page_versions (page_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_sessions_user ON ingestion_sessions (user_id);

-- ---------------------------------------------------------------------------
-- 5. Canonical tag seed data
-- ---------------------------------------------------------------------------

INSERT OR IGNORE INTO tags (slug, label_ja, label_en, color) VALUES
  ('event-operations',  'イベント運営',         'Event Operations',            '#4285F4'),
  ('speaker-management','スピーカー管理',        'Speaker Management',          '#EA4335'),
  ('sponsor-relations', 'スポンサー・渉外',      'Sponsor & External Relations','#FBBC05'),
  ('project',           'プロジェクト',          'Project',                     '#34A853'),
  ('onboarding',        '新メンバー向け',        'Onboarding',                  '#7B61FF'),
  ('community-ops',     'コミュニティ運営',      'Community Ops',               '#FF6D00'),
  ('technical',         '技術',                  'Technical',                   '#00BCD4'),
  ('template',          'テンプレート',          'Template',                    '#9E9E9E');
