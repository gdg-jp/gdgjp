-- Eval fixtures (Stage 06): two e2e spaces in the production wiki, nothing else.
-- Idempotent. Apply with:
--   pnpm --filter @gdgjp/wiki exec wrangler d1 execute DB --remote --file ../../docs/eval/fixtures/setup.sql
-- Then push fixtures/pages with the runner token (README.md).
INSERT OR IGNORE INTO spaces (id, slug, name, kind, lang)
  VALUES ('e2e-eval', 'e2e-eval', 'E2E Eval', 'shared', 'ja'),
         ('e2e-eval-private', 'e2e-eval-private', 'E2E Eval (organizers)', 'shared', 'ja');
INSERT OR IGNORE INTO space_members (space_id, principal_type, principal_id, role) VALUES
  ('e2e-eval', 'public', '*', 'viewer'),
  ('e2e-eval', 'chapter_role', 'e2e-chapter:member', 'viewer'),
  ('e2e-eval-private', 'chapter_role', 'e2e-chapter:organizer', 'viewer');
-- The restricted source the organizer-only spans cite.
INSERT OR IGNORE INTO sources (id, kind, url, title, chapter_id, added_by, status, visibility, space_id)
  VALUES ('src-e2e-org', 'text', 'https://wiki.gdgs.jp/e2e/organizer-notes', 'E2E organizer notes',
          'e2e-chapter', 'runner', 'ready', 'chapter-organizer', 'e2e-eval');
