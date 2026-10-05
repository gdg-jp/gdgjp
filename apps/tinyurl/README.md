# @gdgjp/tinyurl

URL shortener for GDG Japan, deployed at `url.gdgs.jp` (dashboard) with short links resolved on
the `gdgs.jp` and `go.gdgs.jp` apex zones. Cloudflare Worker, D1-backed, React Router v7 SSR, and
an OAuth relying party of `accounts/`.

Members create short links, organize them into folders and campaigns, tag them, set link-level
sharing (owner / chapter co-owner / per-principal editor-viewer grants / public visibility), and
read click analytics. Bot crawlers hitting a short link get an OG-tag preview page instead of a
redirect, so link previews render correctly in chat apps and social platforms.

## Tech stack and bindings

React Router v7 (SSR) on a Cloudflare Worker, D1, Analytics Engine, and two service bindings back
to other Workers in this repo. Bindings declared in `wrangler.toml`:

| Binding | Type | Purpose |
| --- | --- | --- |
| `DB` | D1 (`gdgjp-tinyurl-db`) | Links, domains, folders, tags, campaigns, permissions, userinfo cache. Migrated with `migrations/`, dumped to `schema.sql`. |
| `CLICKS_AE` | Analytics Engine (`tinyurl_clicks`) | Click events, written via `writeDataPoint` (no secret needed). Reading aggregates for the analytics/dashboard pages goes through the AE SQL API and needs `CF_ACCOUNT_ID` + `CF_AE_API_TOKEN`. |
| `ASSETS` | Assets | Static client build (`./build/client`), also serves the `gdg` CLI installer scripts at `gdgs.jp/cli/install.sh` / `.ps1`. |
| `IMG_UPLOAD`, `IMG_HTTP` | Service bindings | RPC and HTTP entrypoints into `img/` (`gdgjp-img`) for OG image uploads. |
| `ACCOUNTS` | Service binding | OIDC HTTP calls to `accounts/` (`gdgjp-accounts`), used by the RP auth flow instead of a public fetch. |

Custom short-link domains are provisioned through Vercel (see `tinyurl-gateway/`); this Worker
holds the Vercel API credentials and the shared secret used to authenticate gateway requests:
`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GATEWAY_SHARED_SECRET`.

## Request flow

`workers/app.ts` inspects every request before handing off to React Router:

1. `gdgs.jp/cli/install.sh` and `install.ps1` are served straight from `ASSETS` (the `gdg` CLI
   installer), regardless of the routing below.
2. `/api/internal/gateway/*` is HMAC-authenticated (`app/lib/gateway-internal.ts`,
   `app/lib/hmac.ts`) and serves `tinyurl-gateway`'s config lookup and signed resolution requests
   for custom domains.
3. `isApexRedirect()` matches requests where `Host` equals `SHORT_URL_BASE`'s host or
   `go.gdgs.jp`, or the path starts with `/r/`. These go straight to
   `handleApexRedirect()` in `app/lib/redirect-handler.ts`: look up the link by slug, fire a
   `ctx.waitUntil` click write to `CLICKS_AE`, and return a 302 — or an OG-tag preview page when
   the user agent is a bot (via `isbot`). This path never touches React Router.
4. Everything else (the `url.gdgs.jp` dashboard) goes through `createRequestHandler` and the
   route tree in `app/routes.ts`.

Because slug resolution exists on both the apex fast path and the catch-all `:slug` route, the
in-repo `tinyurl/CLAUDE.md` calls out: change both when changing slug resolution, or behavior
becomes host-dependent.

## Directory structure

| Path | Contents |
| --- | --- |
| `app/routes/` | Dashboard pages (`home`, `dashboard`/`links`, `links/:id`, `folders`, `folders/:id`, `tags`, `campaigns`, `campaigns/:id`, `analytics`, `domains`), auth routes (`api/auth/*`, `auth/signout`, `signin`, `no-chapter`), the JSON API (`api/links`, `api/images/upload`), and the catch-all `:slug` resolver. Registered in `app/routes.ts`. |
| `app/lib/` | Server logic: `db.ts` (D1 queries), `redirect-handler.ts` / `short-url.ts` / `slug.ts` (link resolution and slugging), `domains.ts` / `domain-provider.ts` / `domain-detection.ts` / `gateway-internal.ts` / `hmac.ts` (custom-domain provisioning and the signed gateway API), `analytics-engine.ts` / `analytics-engine-write.ts` / `analytics-filters.ts` (Analytics Engine read/write, including the `LINK_ID_RE`-based SQL sanitizers AE's lack of parameter binding requires), `campaign-*` (campaign channels, participant import, acquisition analytics), `permissions.ts` (link authorization), `auth.server.ts` / `auth-redirect.ts` (the `gdg-lib` RP wiring), `chapter.server.ts` (chapter membership from IdP `/userinfo`), `cli-installer.server.ts` (serves the `gdg` CLI install scripts from `gdgs.jp`). |
| `app/components/` | Dashboard UI: link list/cards/dialogs, folder and tag pickers, campaign dialogs and participant import wizard, analytics charts and filter bar, plus a local `ui/` primitives set (Radix-based). |
| `workers/app.ts` | Worker entrypoint: CLI-installer short-circuit, gateway-internal routing, apex-redirect fast path, then React Router. |
| `migrations/` | D1 schema history — links, tags, comments, permissions, the better-auth-to-userinfo-cache migration path (0006–0015), campaigns, link archiving, custom domains, OIDC subject, folders. `schema.sql` is generated from these; edit migrations, not the dump. |
| `openapi/` | OpenAPI spec for the gateway-internal API (`openapi.yaml`, `paths/`, `components/`), bundled to `openapi/dist/` and typed to `openapi/types.generated.ts`, consumed by `gateway-internal.ts`. |
| `e2e/` | Playwright specs (currently `home.spec.ts`). |

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in:

| Variable | Purpose |
| --- | --- |
| `RP_SESSION_SECRET` | HMAC key for the RP's signed session + OIDC transaction cookies. Generate with `openssl rand -base64 48`. |
| `IDP_CLIENT_SECRET` | OAuth client secret issued by the `accounts/` IdP for this RP. |
| `CF_ACCOUNT_ID`, `CF_AE_API_TOKEN` | Needed for the `/analytics` and `/dashboard` pages to read Analytics Engine via the SQL API (token needs Account → Account Analytics: Read). |
| `APP_URL`, `ACCOUNTS_URL`, `IDP_URL`, `SHORT_URL_BASE` | Override the prod URLs from `wrangler.toml` so dev points at a local `accounts` IdP and serves short links from the same host as the dev server (`SHORT_URL_BASE=http://localhost:5174`), which keeps the apex fast path exercisable locally. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `GATEWAY_SHARED_SECRET` | Custom-domain provisioning; production values are `wrangler secret put`. |

Per repo convention, when the `accounts/` client id/secret/redirect URI for `tinyurl` change,
reseed via `/admin/seed-clients` on `accounts/` before testing sign-in.

`e2e/` Playwright tests boot both `accounts` (`:5173`) and `tinyurl` (`:5174`) via
`playwright.config.ts`'s `webServer`; if e2e is flaky, check both came up.

## Scripts

Run from the repo root with `pnpm --filter @gdgjp/tinyurl <script>`, or `pnpm <script>` from
inside `tinyurl/`.

| Script | Purpose |
| --- | --- |
| `dev` | `react-router dev` — local dev server. |
| `build` | `react-router build`. |
| `deploy` | `wrangler deploy`. |
| `typecheck` | `wrangler types && react-router typegen && tsc --noEmit`. |
| `cf-typegen` | `wrangler types` alone — run after changing `wrangler.toml` bindings. |
| `migrate:local` / `migrate:remote` | `wrangler d1 migrations apply gdgjp-tinyurl-db --local|--remote`, then dumps `schema.sql` via `../scripts/dump-schema.sh`. |
| `test` / `test:watch` | Vitest (26 `*.test.ts`/`*.test.tsx` files beside the code they cover). |
| `test:e2e` | Playwright, `e2e/`. |
| `openapi:lint` / `openapi:bundle` / `openapi:generate` | Redocly lint/bundle of `openapi/openapi.yaml` and `openapi-typescript` generation of `openapi/types.generated.ts`, used by the gateway-internal API. |

Prefer the repo-root `pnpm ci:quick` / `pnpm ci:full` during development; use the scripts above
when fixing a specific failure.

## Related package

`tinyurl-gateway/` is a separate Vercel Edge package that terminates TLS for custom short-link
apex domains and proxies to this Worker's `/api/internal/gateway/*` endpoints over a shared
secret (`GATEWAY_SHARED_SECRET`) once a domain's `status` is `active` in the `domains` table. See
`tinyurl-gateway/README.md` for its deployment and configuration details.
