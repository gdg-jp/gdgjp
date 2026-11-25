-- Deterministic, clearly fake fixture rows for the verify-pay feature map.
-- Every name, bank, account number, e-mail, and URL below is fabricated.
-- The two account_number_enc values are AES-GCM ciphertexts of "0000001" and
-- "0000002" under TOKEN_ENCRYPTION_KEY=verify-pay-token-encryption-key.
-- Apply only to a disposable local D1 created by the verification helper.

INSERT INTO "user" (id, email, name, image, oidc_issuer, oidc_subject, created_at, updated_at)
VALUES
  ('dev-user-organizer', 'organizer@dev.local', 'organizer (dev)', NULL,
   'http://localhost:6173', 'dev-organizer', 1767225600, 1767225600),
  ('dev-user-member', 'member@dev.local', 'member (dev)', NULL,
   'http://localhost:6173', 'dev-member', 1767225600, 1767225600);

INSERT INTO events (
  id, title, owner_user_id, owner_chapter_ids, status, created_at,
  google_admin_user_id, google_drive_folder_id, google_drive_folder_name
) VALUES
  ('evt_0000000000000000000000SEE1', 'Verify Seed Event', 'dev-user-organizer', '[1]',
   'open', 1767225600, NULL, NULL, NULL),
  ('evt_0000000000000000000000SEE2', 'Verify Google Seed Event', 'dev-user-organizer', '[1]',
   'open', 1767225660, 'dev-user-organizer', 'fixture-folder-id', 'Verify Fixture Folder');

INSERT INTO google_oauth_tokens (
  user_id, google_email, access_token_enc, refresh_token_enc,
  access_token_expires_at, template_granted_at, created_at, updated_at
) VALUES (
  'dev-user-organizer', 'verify-organizer@example.invalid', 'fixture-not-a-token',
  'fixture-not-a-token', 0, 1767225660, 1767225660, 1767225660
);

INSERT INTO claims (
  id, event_id, kind, user_id, applicant_name, bank_name, branch_name, account_type,
  account_number_enc, application_date, total_amount, sheet_id, sheet_url, drive_folder_id,
  email_sent_at, status, created_by, created_at, updated_at
) VALUES
  ('clm_0000000000000000000000SEC1', 'evt_0000000000000000000000SEE1', 'proxy', NULL,
   '検証 代行花子（架空）', '架空検証銀行', '検証支店', '普通',
   'AAAAAAAAAAAAAAAB.J5CUrgp8M3pAmzpWeUluuj7YVzNE4Gs=', '2026-01-05', 4500,
   NULL, NULL, NULL, NULL, 'draft', 'dev-user-organizer', 1767225700, 1767225700),
  ('clm_0000000000000000000000SEC2', 'evt_0000000000000000000000SEE1', 'self', 'dev-user-member',
   '検証 メンバー太郎（架空）', '架空検証銀行', '検証支店', '普通',
   'AAAAAAAAAAAAAAAC.K99//nidpXWK2WoWJ2t6EH608Do/Ffc=', '2026-01-06', 2000,
   'fixture-sheet-id', 'https://example.invalid/verify-pay/fixture-sheet', NULL,
   NULL, 'synced', 'dev-user-member', 1767225800, 1767225800);

INSERT INTO claim_items (
  id, claim_id, spent_on, category, description, amount_yen, receipt_r2_key,
  receipt_filename, receipt_content_type, receipt_drive_file_id, extraction_json,
  sort_order, created_at
) VALUES
  ('itm_FIXTURE_C1_A', 'clm_0000000000000000000000SEC1', '2026-01-05', '会場費',
   '検証用会場費（架空）', 3000, NULL, NULL, NULL, NULL, NULL, 0, 1767225700),
  ('itm_FIXTURE_C1_B', 'clm_0000000000000000000000SEC1', '2026-01-05', '交通費',
   '検証用交通費（架空）', 1500, NULL, NULL, NULL, NULL, NULL, 1, 1767225701),
  ('itm_FIXTURE_C2_A', 'clm_0000000000000000000000SEC2', '2026-01-06', 'ケータリング',
   '検証用軽食（架空）', 2000,
   'claims/clm_0000000000000000000000SEC2/fixture-receipt.png', 'fixture-receipt.png',
   'image/png', NULL, NULL, 0, 1767225800);
