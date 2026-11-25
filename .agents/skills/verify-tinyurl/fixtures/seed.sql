-- Deterministic fixture rows for the verify-tinyurl feature map.
-- Apply only to the disposable local D1 created by the verification helper, after migrations.
-- Run from the snapshot's apps/tinyurl directory:
--   pnpm exec wrangler d1 execute gdgjp-tinyurl-db --local --persist-to .wrangler/state \
--     --file <absolute path to this file>
-- Every hostname, slug, user, and URL is fabricated. Destinations are IP literals so link
-- validation never needs DNS-over-HTTPS, and no journey follows a redirect to them.
-- No public link, folder, tag, or campaign is seeded: the empty-state journeys depend on that.

-- Local apex for the redirect fast path. SHORT_URL_BASE=http://localhost:6169 makes the Worker
-- look up links by the host "localhost:6169"; the migrated system domains gdgs.jp and go.gdgs.jp
-- never match a local request. Change this hostname if the helper serves another port.
INSERT INTO domains (id, hostname, kind, mode, status)
VALUES (100, 'localhost:6169', 'system', 'short-only', 'active');

-- Active custom short-only domain owned by chapter 101. It drives the Domains page custom card,
-- chapter-owned links, and the tinyurl-gateway journey. It is never provisioned at Vercel.
INSERT INTO domains (id, hostname, kind, mode, owner_chapter_id, status, created_by_user_id)
VALUES (101, 'verify-gw.example', 'custom', 'short-only', 101, 'active', 'dev-user-owner');

-- Owner of the private link below. Same id, email, issuer, and subject that
-- /dev/login?as=outsider writes, so a later outsider sign-in updates this row in place.
INSERT INTO "user" (id, email, name, image, oidc_issuer, oidc_subject, created_at, updated_at)
VALUES (
  'dev-user-outsider', 'outsider@dev.local', 'outsider (dev)', NULL,
  'http://localhost:6173', 'dev-outsider', 1767225600, 1767225600
);

-- Private personal link of a chapter 202 user. Owner (chapter 101) must get 403 on its detail
-- and analytics pages; the public redirect must still answer 302.
INSERT INTO links (
  id, domain_id, slug, destination_url, title, owner_user_id, owner_chapter_id, visibility,
  created_at, updated_at
) VALUES (
  'link_01KSEED00000000000000000PV', 100, 'verify-seed-private',
  'https://1.1.1.1/verify-seed-private', 'Seeded private link', 'dev-user-outsider', NULL,
  'private', 1767225600, 1767225600
);
