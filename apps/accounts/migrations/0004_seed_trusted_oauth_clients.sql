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
  );
