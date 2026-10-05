-- Seed the wiki OAuth client row so accounts can authenticate the
-- @gdgjp/wiki app at /api/auth/oauth2/* now that wiki has been migrated
-- into this monorepo and wired as an SSO RP.
--
-- The redirect URLs and the real client secret are sourced from accounts'
-- wrangler.toml [vars] (WIKI_REDIRECT_URLS) + secret store (WIKI_CLIENT_SECRET)
-- at runtime — see initializeIdpAuth in gdg-lib's server.ts. This row only
-- needs to exist so better-auth's oidcProvider plugin treats `wiki` as a
-- known clientId; the row from migration 0009 is re-asserted here so a
-- fresh DB built strictly from migrations also has it after 0010.
INSERT OR IGNORE INTO "oauthApplication" (
  "id", "name", "clientId", "clientSecret", "redirectUrls", "type",
  "disabled", "createdAt", "updatedAt"
) VALUES
  (
    'trusted-wiki', 'GDG Japan Wiki', 'wiki', '',
    '[]', 'web', 0,
    '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z'
  );
