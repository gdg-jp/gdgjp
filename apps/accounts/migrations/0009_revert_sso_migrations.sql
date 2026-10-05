-- Forward revert of the seed-row deletion done in 0008. Re-inserts the four
-- trusted-* placeholder rows so the table matches pre-#48 state. These rows
-- were never functionally relied on (clientSecret '' / redirectUrls '[]'),
-- but the user asked for a full revert including DB schema.
INSERT OR IGNORE INTO "oauthApplication" (
  "id", "name", "clientId", "clientSecret", "redirectUrls", "type",
  "disabled", "createdAt", "updatedAt"
) VALUES
  (
    'trusted-tinyurl', 'GDG Japan Links', 'tinyurl', '',
    '[]', 'web', 0,
    '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
  ),
  (
    'trusted-wiki', 'GDG Japan Wiki', 'wiki', '',
    '[]', 'web', 0,
    '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
  ),
  (
    'trusted-img', 'GDG Japan Image', 'img', '',
    '[]', 'web', 0,
    '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'
  ),
  (
    'trusted-scheduler', 'GDG Japan Scheduler', 'scheduler', '',
    '[]', 'web', 0,
    '2026-05-13T00:00:00.000Z', '2026-05-13T00:00:00.000Z'
  );
