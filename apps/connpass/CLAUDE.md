# Connpass API (`connpass.gdgs.jp`)

Machine API for connpass group admin automation via Cloudflare Browser Run.

- Auth: Bearer GDG Accounts access token (CLI / agents)
- Reads/writes: Playwright against connpass.com (shared bot email/password). Official connpass API is not used.
- HTML fixtures for selectors: `fixtures/html/`

Local port: `5179`.

## Local API / E2E

Local D1 is created by `wrangler d1 migrations apply` (the e2e `webServer` runs this
before `pnpm dev`). For a manual session: `pnpm migrate:local && pnpm --filter @gdgjp/connpass dev`.

- `pnpm test:e2e` boots a mock GDG Accounts userinfo server (`:5181`) plus this app (`:5179`)
  and covers auth, allowlist admin, and request validation without touching connpass.com.
- `pnpm test:e2e:live` hits connpass.com via local Browser Run. Needs
  `CONNPASS_E2E_LIVE=1` and bot credentials in `.dev.vars`. Set
  `CONNPASS_E2E_GROUP_SLUG` / `CONNPASS_E2E_EVENT_ID` for scrape coverage, and
  `CONNPASS_E2E_LIVE_WRITES=1` only if you intend to create a real unpublished draft.
  If local Chromium cannot spawn, set `[browser] remote = true` in `wrangler.toml` for that session.
