-- Deterministic fixture rows for verify-sns. Apply to the local gdgjp-sns-db after
-- migrations. All values are fake. No row holds a real X token: every
-- access_token_ciphertext is the literal 'fixture-not-encrypted', which decryptSecret
-- rejects before any X request is built.

INSERT INTO x_accounts (
  id, chapter_id, x_user_id, username, display_name, profile_image_url,
  access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
  authorized_by_user_id, created_at, updated_at, revoked_at
) VALUES
  ('xacc-verify-1', 1, '900000000000000001', 'verify_chapter_one', 'Verify Chapter One', NULL,
   'fixture-not-encrypted', NULL, NULL,
   'dev-user-verify-sns-organizer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('xacc-verify-cli-revoke', 1, '900000000000000004', 'verify_cli_revoke', 'Verify CLI Revoke', NULL,
   'fixture-not-encrypted', NULL, NULL,
   'dev-user-verify-sns-organizer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('xacc-verify-revoke', 1, '900000000000000003', 'verify_revoke_me', 'Verify Revoke Me', NULL,
   'fixture-not-encrypted', NULL, NULL,
   'dev-user-verify-sns-organizer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('xacc-verify-2', 2, '900000000000000002', 'verify_chapter_two', 'Verify Chapter Two', NULL,
   'fixture-not-encrypted', NULL, NULL,
   'dev-user-verify-sns-other', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT INTO posts (
  id, chapter_id, x_account_id, text, scheduled_at, condition, status,
  created_by_user_id, published_x_post_id, published_at, failure_reason,
  link_preview_url, link_preview_title, link_preview_description, link_preview_image_url,
  created_at, updated_at
) VALUES
  ('post-verify-failed', 1, 'xacc-verify-1', 'Verify fixture failed post', '2026-01-01T03:00:00.000Z',
   'scheduled', 'failed', 'dev-user-verify-sns-organizer', NULL, NULL, 'Fixture failure, never sent',
   NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('post-verify-published', 1, 'xacc-verify-1', 'Verify fixture published post', '2026-01-02T03:00:00.000Z',
   'scheduled', 'published', 'dev-user-verify-sns-organizer', 'fixture-not-a-real-x-post',
   '2026-01-02T03:00:05.000Z', NULL,
   NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-02T03:00:05.000Z'),
  ('post-verify-other-chapter', 2, 'xacc-verify-2', 'Verify fixture other chapter post', '2099-01-01T00:00:00.000Z',
   'scheduled', 'scheduled', 'dev-user-verify-sns-other', NULL, NULL, NULL,
   NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO sns_contributors (chapter_id, user_email, granted_by_user_id, created_at) VALUES
  (1, 'verify-sns-contributor@dev.local', 'dev-user-verify-sns-organizer', '2026-01-01T00:00:00.000Z'),
  (1, 'verify-sns-guest@dev.local', 'dev-user-verify-sns-organizer', '2026-01-01T00:00:00.000Z');
