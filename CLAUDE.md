# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout (flat, not `apps/` + `packages/`)

Apps and the shared lib sit at the repo root:

- `accounts/` — auth IdP (`@gdgjp/accounts`, accounts.gdgs.jp). Uses `better-auth` on D1 (binding `DB`); issues OAuth credentials to the other apps via `*_CLIENT_ID` / `*_REDIRECT_URLS` vars in `accounts/wrangler.toml`.
- `tinyurl/` — URL shortener (`@gdgjp/tinyurl`, url.gdgs.jp), D1-backed; OAuth client of `accounts`.
- `wiki/` — community wiki (`@gdgjp/wiki`, wiki.gdgs.jp); no Cloudflare bindings yet.
- `img/` — image hosting (`@gdgjp/img`, img.gdgs.jp). D1 + R2 (`ORIGINALS`) + Cloudflare Images (`IMAGES`) bindings; OAuth client of `accounts`.
- `scheduler/` — meeting scheduler (`@gdgjp/scheduler`, scheduler.gdgs.jp). D1-backed; OAuth client of `accounts`. Anonymous users can fully use the app (create, join, edit own response); authenticated owners additionally get a cross-device "My events" list and can edit/delete events.
- `gdg-lib/` — `@gdgjp/gdg-lib` shared package, consumed via `workspace:*`. Houses the shared `better-auth` / Kysely / `kysely-d1` glue.

`pnpm-workspace.yaml` lists these six directories explicitly. When adding a new app, add it there and run `pnpm install`.

Each app is a React Router v7 (framework mode, SSR) app deployed to Cloudflare Workers. The Worker entry is `workers/app.ts`, which wires `createRequestHandler` to the virtual server build and exposes `env`/`ctx` on `AppLoadContext` under `context.cloudflare`. Routes live in `app/routes/` and are registered in `app/routes.ts`. The `~/*` import alias maps to `./app/*`.

After editing `wrangler.toml` bindings, re-run `pnpm --filter @gdgjp/<app> cf-typegen` (or `pnpm typecheck`) so `worker-configuration.d.ts` picks up the new shape.

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

`wiki` has no `migrate:*` script because it currently has no D1 binding.

When adding a new app, register it in: `pnpm-workspace.yaml`, the `typecheck` / `test` / `build` / `e2e` matrices in `.github/workflows/ci.yml` (and the `.dev.vars` heredoc in the e2e job), and the `deploy` matrix in `.github/workflows/deploy.yml`.

## Conventions

- Biome enforces double quotes, semicolons, trailing commas, 2-space indent, 100-col lines, and `useImportType: error` — use `import type { ... }` for type-only imports.
- TypeScript uses `verbatimModuleSyntax` and `isolatedModules` (inherited from `tsconfig.base.json`); type-only imports/exports must be marked explicitly.
- The shared lib `@gdgjp/gdg-lib` exports source TS directly (`"main": "./src/index.ts"`) — there is no build step for it; consumers compile it through their own bundler. Keep package-local code inside its app unless it is genuinely shared, then move it here.
- Commits follow Conventional Commits, scoped by package: `feat(accounts): ...`, `fix(img): ...`.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build, and Playwright as separate jobs on Node 20 + pnpm. Keep all five green.
