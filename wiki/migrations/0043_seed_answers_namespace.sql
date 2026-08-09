-- Reserved namespace for query write-back answer pages (Stage 5f).
-- Creates a system author when no admin exists so local empty DBs still seed.

INSERT INTO "user" (id, email, name, image, is_admin, created_at, updated_at)
SELECT 'wiki-system', 'wiki-system@gdgs.jp', 'Wiki System', NULL, 1, unixepoch(), unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE id = 'wiki-system')
  AND NOT EXISTS (SELECT 1 FROM "user" WHERE is_admin = 1);

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-answers', '回答', 'Answers', 'answers',
  '# Answers' || char(10) || char(10),
  '# Answers' || char(10) || char(10),
  'human', 'human',
  'クエリ回答の名前空間。',
  'Namespace for filed query answers.',
  NULL, 70, 'published', 'answer', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'answers');
