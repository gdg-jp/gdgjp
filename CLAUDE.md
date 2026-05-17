# CLAUDE.md

Guidance for Claude Code working in this repo.

## Repo layout (flat — no `apps/` + `packages/`)

Six workspace dirs at repo root, listed in `pnpm-workspace.yaml`:

- `accounts/` — OIDC IdP (`@gdgjp/accounts`, accounts.gdgs.jp). On `@cloudflare/workers-oauth-provider` + D1 (`DB`) + KV (`OAUTH_KV`). Does NOT consume `gdg-lib`. better-auth was used briefly (migrations 0002–0011) and removed — don't reintroduce.
- `tinyurl/` — URL shortener (url.gdgs.jp). D1. RP of accounts.
- `wiki/` — wiki (wiki.gdgs.jp). D1 + R2 (`BUCKET`) + Queues (`TRANSLATION_QUEUE`, `INGESTION_QUEUE`) + Browser Rendering (`BROWSER`) + Workers AI (`AI`) + Vectorize (`VECTORIZE`) + Durable Object (`COLLAB_DO`). Uses Drizzle (the others use Kysely). RP of accounts.
- `img/` — image hosting (img.gdgs.jp). D1 + R2 (`ORIGINALS`) + Cloudflare Images (`IMAGES`). RP of accounts.
- `scheduler/` — meeting scheduler (scheduler.gdgs.jp). D1. RP of accounts. Anon users fully usable; sign-in adds cross-device "My events".
- `gdg-lib/` — `@gdgjp/gdg-lib`, `workspace:*`. Houses the RP factory `initializeRpAuth` (mounted under `/api/auth/*` by the four RPs) and signed-cookie HMAC helpers (`signPayload` / `verifyPayload`). IdP does not consume it.

Every app is React Router v7 (framework mode, SSR) on Cloudflare Workers. Worker entry `workers/app.ts` wires `createRequestHandler` and exposes `env`/`ctx` on `context.cloudflare`. Routes in `app/routes/`, registered in `app/routes.ts`. `~/*` → `./app/*`.

Each workspace has its own `CLAUDE.md`. Read both when working in an app.

Dev ports (also used by Playwright `webServer`; RPs boot `accounts` alongside):

| accounts | tinyurl | img | scheduler | wiki |
|---|---|---|---|---|
| 5173 | 5174 | 5175 | 5176 | 5177 |

After editing `wrangler.toml` bindings, run `pnpm --filter @gdgjp/<app> cf-typegen` (or `typecheck`) to regenerate `worker-configuration.d.ts`.

## Cross-cutting secrets

Every RP `.dev.vars` needs `RP_SESSION_SECRET` (HMAC; `openssl rand -base64 48`) and `IDP_CLIENT_SECRET`.

`accounts/` needs `IDP_SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, and `<APP>_CLIENT_SECRET` for each RP (`TINYURL_`, `WIKI_`, `IMG_`, `SCHEDULER_`). After changing any `<APP>_CLIENT_SECRET` / `<APP>_CLIENT_ID` / `<APP>_REDIRECT_URLS`, **hit `/admin/seed-clients`** — change doesn't take effect until KV is re-seeded.

## Commands

Run from repo root (Turborepo fans out):

- `pnpm dev` / `build` / `typecheck` / `test` / `test:e2e` / `lint` (`lint:fix`, `format`) / `deploy`
- `typecheck` = `wrangler types && react-router typegen && tsc --noEmit`
- Biome only (no ESLint/Prettier)
- `deploy` runs `wrangler deploy` per app

Scope to one app: `pnpm --filter @gdgjp/<app> <script>`. Single test: `pnpm --filter @gdgjp/<app> exec vitest run <path>` / `exec playwright test <spec>`.

D1 migrations (per app, not `gdg-lib`): `migrate:local` / `migrate:remote`. Both replay migrations and regenerate `schema.sql` via `scripts/dump-schema.sh` (also exposed as `schema:dump`). `schema.sql` is generated — edit migrations, not the dump.

Adding a new app: register in `pnpm-workspace.yaml`, the matrices in `.github/workflows/ci.yml` (incl. the `.dev.vars` heredoc in the e2e job), and `deploy.yml`.

## Conventions

- Biome: double quotes, semicolons, trailing commas, 2-space, 100 col, `useImportType: error`.
- TS: `verbatimModuleSyntax` + `isolatedModules` (from `tsconfig.base.json`) — mark type-only imports/exports explicitly.
- `gdg-lib` has no build step (`"main": "./src/index.ts"`); consumers bundle it.
- Conventional Commits scoped per package: `feat(accounts): …`, `fix(img): …`.
- CI runs lint, typecheck, unit, build, Playwright as separate jobs (Node 20 + pnpm). Keep all five green.
