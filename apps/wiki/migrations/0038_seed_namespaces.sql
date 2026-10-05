-- Top-level type namespaces plus index/log for the LLM Wiki pattern.
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
  'ns-index', '索引', 'Index', 'index',
  '## Events' || char(10) || char(10) ||
  '## Venues' || char(10) || char(10) ||
  '## Vendors' || char(10) || char(10) ||
  '## People' || char(10) || char(10) ||
  '## Organizations' || char(10) || char(10) ||
  '## Playbooks' || char(10),
  '## Events' || char(10) || char(10) ||
  '## Venues' || char(10) || char(10) ||
  '## Vendors' || char(10) || char(10) ||
  '## People' || char(10) || char(10) ||
  '## Organizations' || char(10) || char(10) ||
  '## Playbooks' || char(10),
  'human', 'human',
  'カタログ。種類ごとのページ一覧。',
  'Catalog of all pages by type.',
  NULL, 0, 'published', 'wiki-index', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'index');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-log', 'ログ', 'Log', 'log',
  '# Log' || char(10) || char(10),
  '# Log' || char(10) || char(10),
  'human', 'human',
  '追記専用の作業ログ。',
  'Append-only operational log.',
  NULL, 1, 'published', 'wiki-log', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'log');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-events', 'イベント', 'Events', 'events',
  '# Events' || char(10) || char(10),
  '# Events' || char(10) || char(10),
  'human', 'human',
  'イベント記録の名前空間。',
  'Namespace for event records.',
  NULL, 10, 'published', 'event', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'events');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-venues', '会場', 'Venues', 'venues',
  '# Venues' || char(10) || char(10),
  '# Venues' || char(10) || char(10),
  'human', 'human',
  '会場の名前空間。',
  'Namespace for venues.',
  NULL, 20, 'published', 'venue', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'venues');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-vendors', '業者', 'Vendors', 'vendors',
  '# Vendors' || char(10) || char(10),
  '# Vendors' || char(10) || char(10),
  'human', 'human',
  '業者の名前空間。',
  'Namespace for vendors.',
  NULL, 30, 'published', 'vendor', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'vendors');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-people', '人物', 'People', 'people',
  '# People' || char(10) || char(10),
  '# People' || char(10) || char(10),
  'human', 'human',
  '人物の名前空間。',
  'Namespace for people.',
  NULL, 40, 'published', 'person', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'people');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-orgs', '組織', 'Organizations', 'orgs',
  '# Organizations' || char(10) || char(10),
  '# Organizations' || char(10) || char(10),
  'human', 'human',
  '組織の名前空間。',
  'Namespace for organizations.',
  NULL, 50, 'published', 'organization', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'orgs');

INSERT INTO "pages" (
  id, title_ja, title_en, slug, content_ja, content_en,
  translation_status_ja, translation_status_en, summary_ja, summary_en,
  parent_id, sort_order, status, page_type, page_metadata,
  visibility, general_role, chapter_id, author_id, last_edited_by,
  created_at, updated_at, origin
)
SELECT
  'ns-playbooks', 'プレイブック', 'Playbooks', 'playbooks',
  '# Playbooks' || char(10) || char(10),
  '# Playbooks' || char(10) || char(10),
  'human', 'human',
  '手順書の名前空間。',
  'Namespace for playbooks.',
  NULL, 60, 'published', 'playbook', NULL,
  'restricted', 'viewer', NULL,
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  COALESCE((SELECT id FROM "user" WHERE is_admin = 1 ORDER BY created_at LIMIT 1), 'wiki-system'),
  unixepoch(), unixepoch(), 'agent'
WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE slug = 'playbooks');
