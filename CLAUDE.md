# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout (flat, not `apps/` + `packages/`)

Apps and the shared lib sit at the repo root:

- `accounts/` — auth IdP (`@gdgjp/accounts`, accounts.gdgs.jp). Built on `@cloudflare/workers-oauth-provider` over D1 (binding `DB`) + KV (`OAUTH_KV`); issues OAuth credentials to the other apps via `*_CLIENT_ID` / `*_REDIRECT_URLS` vars in `accounts/wrangler.toml`. (better-auth was used briefly — migrations 0002 → 0011 — but is gone; don't reintroduce it.)
- `tinyurl/` — URL shortener (`@gdgjp/tinyurl`, url.gdgs.jp), D1-backed; OAuth client of `accounts`.
- `wiki/` — community wiki (`@gdgjp/wiki`, wiki.gdgs.jp). D1 (`DB`) + R2 (`BUCKET`) + Queues (`TRANSLATION_QUEUE`, `INGESTION_QUEUE`) + Browser Rendering (`BROWSER`) + Workers AI (`AI`) + Vectorize (`VECTORIZE`) + Durable Object (`COLLAB_DO`, for Yjs collab) bindings; uses Drizzle (not Kysely). OAuth client of `accounts` via `gdg-lib`'s RP factory (migrations 0021/0022 dropped the standalone better-auth setup).
- `img/` — image hosting (`@gdgjp/img`, img.gdgs.jp). D1 + R2 (`ORIGINALS`) + Cloudflare Images (`IMAGES`) bindings; OAuth client of `accounts`.
- `scheduler/` — meeting scheduler (`@gdgjp/scheduler`, scheduler.gdgs.jp). D1-backed; OAuth client of `accounts`. Anonymous users can fully use the app (create, join, edit own response); authenticated owners additionally get a cross-device "My events" list and can edit/delete events.
- `gdg-lib/` — `@gdgjp/gdg-lib` shared package, consumed via `workspace:*`. Houses the **RP factory** (`initializeRpAuth`) the four downstream apps wire under `/api/auth/*` and the shared signed-cookie HMAC helpers (`signPayload` / `verifyPayload`) used by both sides. The IdP itself does NOT consume gdg-lib.

`pnpm-workspace.yaml` lists these six directories explicitly. When adding a new app, add it there and run `pnpm install`.

Each app is a React Router v7 (framework mode, SSR) app deployed to Cloudflare Workers. The Worker entry is `workers/app.ts`, which wires `createRequestHandler` to the virtual server build and exposes `env`/`ctx` on `AppLoadContext` under `context.cloudflare`. Routes live in `app/routes/` and are registered in `app/routes.ts`. The `~/*` import alias maps to `./app/*`.

Each workspace directory (`accounts/`, `tinyurl/`, `wiki/`, `img/`, `scheduler/`, `gdg-lib/`) has its own `CLAUDE.md` with app-specific architecture (auth wiring, bindings, data model, gotchas). When working inside an app, read both this file and that app's `CLAUDE.md`.

Dev ports (used by `pnpm dev` and by Playwright `webServer` blocks — RPs boot `accounts` alongside themselves):

| App | Port |
| --- | --- |
| `accounts` | 5173 |
| `tinyurl` | 5174 |
| `img` | 5175 |
| `scheduler` | 5176 |
| `wiki` | 5177 |

After editing `wrangler.toml` bindings, re-run `pnpm --filter @gdgjp/<app> cf-typegen` (or `pnpm typecheck`) so `worker-configuration.d.ts` picks up the new shape.

## Cross-cutting secrets contract

Every RP (`tinyurl`, `wiki`, `img`, `scheduler`) needs in its `.dev.vars`:

- `RP_SESSION_SECRET` — HMAC key for the RP session cookie (generate with `openssl rand -base64 48`).
- `IDP_CLIENT_SECRET` — the per-app secret matching the entry seeded in `accounts/`'s `OAUTH_KV`.

The IdP (`accounts/`) needs:

- `IDP_SESSION_SECRET` — HMAC key for the IdP login cookie.
- `GOOGLE_CLIENT_SECRET` — for Google-as-upstream login on the IdP.
- One `<APP>_CLIENT_SECRET` per RP (`TINYURL_CLIENT_SECRET`, `WIKI_CLIENT_SECRET`, `IMG_CLIENT_SECRET`, `SCHEDULER_CLIENT_SECRET`). After changing any of these or the matching `<APP>_CLIENT_ID` / `<APP>_REDIRECT_URLS` in `accounts/wrangler.toml`, hit the `/admin/seed-clients` route — the change does NOT take effect until KV is re-seeded.

## Commands

Run from the repo root unless noted. Turborepo fans out to all workspaces.

- `pnpm dev` — run all apps' dev servers (`react-router dev`, persistent, uncached)
- `pnpm build` — production build of every app
- `pnpm typecheck` — runs `wrangler types && react-router typegen && tsc --noEmit` per app
- `pnpm test` — Vitest unit tests across all workspaces
- `pnpm test:e2e` — Playwright E2E (boots `pnpm dev` via the `webServer` config)
- `pnpm lint` / `pnpm lint:fix` / `pnpm format` — Biome (no ESLint/Prettier)
- `pnpm deploy` — `wrangler deploy` per app (depends on `build`)

Scope to a single app with `--filter`:

```
pnpm --filter @gdgjp/accounts dev
pnpm --filter @gdgjp/accounts test
pnpm --filter @gdgjp/accounts test:e2e
```

Single Vitest file: `pnpm --filter @gdgjp/accounts exec vitest run app/path/to/file.test.ts`.
Single Playwright spec: `pnpm --filter @gdgjp/accounts exec playwright test e2e/home.spec.ts`.

D1 migrations (defined per app under `migrations/`):

```
pnpm --filter @gdgjp/<app> migrate:local    # apply against local wrangler dev DB
pnpm --filter @gdgjp/<app> migrate:remote   # apply against the deployed DB
```

Every workspace app has a `migrations/` dir and exposes `migrate:local` / `migrate:remote` except `gdg-lib` (no DB of its own).

Each app with a `migrations/` dir also has a `schema.sql` checked in — a consolidated dump of the post-migration schema, regenerated by `scripts/dump-schema.sh` (replays the migrations into a throwaway SQLite). `migrate:local` / `migrate:remote` run it automatically; you can also invoke it directly with `pnpm --filter @gdgjp/<app> schema:dump`. Treat `schema.sql` as generated — edit migrations, not the dump.

When adding a new app, register it in: `pnpm-workspace.yaml`, the `typecheck` / `test` / `build` / `e2e` matrices in `.github/workflows/ci.yml` (and the `.dev.vars` heredoc in the e2e job), and the `deploy` matrix in `.github/workflows/deploy.yml`.

## Conventions

- Biome enforces double quotes, semicolons, trailing commas, 2-space indent, 100-col lines, and `useImportType: error` — use `import type { ... }` for type-only imports.
- TypeScript uses `verbatimModuleSyntax` and `isolatedModules` (inherited from `tsconfig.base.json`); type-only imports/exports must be marked explicitly.
- The shared lib `@gdgjp/gdg-lib` exports source TS directly (`"main": "./src/index.ts"`) — there is no build step for it; consumers compile it through their own bundler. Keep package-local code inside its app unless it is genuinely shared, then move it here.
- Commits follow Conventional Commits, scoped by package: `feat(accounts): ...`, `fix(img): ...`.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build, and Playwright as separate jobs on Node 20 + pnpm. Keep all five green.
