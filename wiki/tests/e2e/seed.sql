-- Deterministic, local-only fixture for Wiki browser tests.
-- This file is intentionally idempotent: global setup may run more than once.

DELETE FROM page_access WHERE page_id = 'e2e-test-page-id';

INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
VALUES
  ('e2e-admin-user-id', 'admin@test.local', 'E2E Admin', NULL, 1, unixepoch(), unixepoch()),
  ('e2e-author-user-id', 'author@test.local', 'E2E Author', NULL, 0, unixepoch(), unixepoch()),
  ('e2e-member-user-id', 'member@test.local', 'E2E Member', NULL, 0, unixepoch(), unixepoch())
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  name = excluded.name,
  image = excluded.image,
  is_admin = excluded.is_admin,
  updated_at = excluded.updated_at;

INSERT INTO user_preferences (user_id, preferred_ui_language, preferred_content_language, discord_id)
VALUES
  ('e2e-admin-user-id', 'ja', 'ja', NULL),
  ('e2e-author-user-id', 'ja', 'ja', NULL),
  ('e2e-member-user-id', 'ja', 'ja', NULL)
ON CONFLICT(user_id) DO UPDATE SET
  preferred_ui_language = 'ja',
  preferred_content_language = 'ja',
  discord_id = NULL;

INSERT INTO pages (
  id,
  title_ja,
  title_en,
  slug,
  content_ja,
  content_en,
  summary_ja,
  summary_en,
  parent_id,
  sort_order,
  status,
  page_type,
  page_metadata,
  ingestion_session_id,
  actionability_score,
  author_id,
  last_edited_by,
  created_at,
  updated_at,
  visibility,
  chapter_id,
  general_role,
  sync_revision,
  origin,
  acl_synced_with_parent,
  acl_source_ids
)
VALUES (
  'e2e-test-page-id',
  'E2E Test Page',
  'E2E Test Page',
  'e2e-test-page',
  '{"type":"doc","content":[]}',
  '{"type":"doc","content":[]}',
  '',
  '',
  NULL,
  0,
  'published',
  NULL,
  NULL,
  NULL,
  NULL,
  'e2e-author-user-id',
  'e2e-author-user-id',
  unixepoch(),
  unixepoch(),
  'restricted',
  NULL,
  'viewer',
  1,
  'human',
  1,
  '[]'
)
ON CONFLICT(id) DO UPDATE SET
  title_ja = excluded.title_ja,
  title_en = excluded.title_en,
  slug = excluded.slug,
  content_ja = excluded.content_ja,
  content_en = excluded.content_en,
  summary_ja = excluded.summary_ja,
  summary_en = excluded.summary_en,
  parent_id = NULL,
  sort_order = 0,
  status = 'published',
  page_type = NULL,
  page_metadata = NULL,
  ingestion_session_id = NULL,
  actionability_score = NULL,
  author_id = excluded.author_id,
  last_edited_by = excluded.last_edited_by,
  updated_at = excluded.updated_at,
  visibility = 'restricted',
  chapter_id = NULL,
  general_role = 'viewer',
  sync_revision = 1,
  origin = 'human',
  acl_synced_with_parent = 1,
  acl_source_ids = '[]';
