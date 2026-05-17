# gdgjp

Monorepo for the GDG Japan web properties. Flat layout (apps and the shared lib sit side-by-side at the repo root), pnpm workspaces, Turborepo, Biome. Every app is a React Router v7 (framework mode, SSR) app deployed to Cloudflare Workers; persistent state lives on Cloudflare D1.

## Apps

| Directory | Package | Hostname | Description |
|---|---|---|---|
| `accounts/` | `@gdgjp/accounts` | accounts.gdgs.jp | Auth IdP — built on `@cloudflare/workers-oauth-provider` over D1 + KV, issues OAuth credentials to the other apps. |
| `tinyurl/` | `@gdgjp/tinyurl` | url.gdgs.jp | URL shortener. D1-backed; OAuth client of `accounts`. |
| `wiki/` | `@gdgjp/wiki` | wiki.gdgs.jp | Community wiki. D1 + R2 + Queues + Browser Rendering + Workers AI + Vectorize + Durable Object (Yjs collab); OAuth client of `accounts`. |
| `img/` | `@gdgjp/img` | img.gdgs.jp | Image hosting. D1 + R2 + Cloudflare Images; OAuth client of `accounts`. |
| `scheduler/` | `@gdgjp/scheduler` | scheduler.gdgs.jp | Meeting scheduler. Anonymous-friendly: anyone can create an event with a weekly schedule and meeting length, and pick available slots; authenticated owners get a cross-device "My events" list plus edit/delete. D1-backed; OAuth client of `accounts`. |
| `gdg-lib/` | `@gdgjp/gdg-lib` | — | Shared RP factory (`initializeRpAuth`) + signed-cookie HMAC helpers, consumed via `workspace:*`. Source-only (no build step). |

## Commands

Run from the repo root unless noted. Turborepo fans out to every workspace.

```sh
pnpm install
pnpm dev          # run every app's dev server
pnpm build        # production build of every app
pnpm typecheck    # wrangler types && react-router typegen && tsc --noEmit, per app
pnpm test         # Vitest unit tests across the workspace
pnpm test:e2e     # Playwright (boots dev servers via its webServer config)
pnpm lint         # Biome (no ESLint/Prettier)
```

Scope to one app with `--filter`:

```sh
pnpm --filter @gdgjp/scheduler dev
pnpm --filter @gdgjp/scheduler test
pnpm --filter @gdgjp/scheduler migrate:local    # apply D1 migrations to local wrangler DB
pnpm --filter @gdgjp/scheduler migrate:remote   # apply D1 migrations to the deployed DB
```

Every app except `gdg-lib` has D1 migrations and exposes `migrate:local` / `migrate:remote`.

## Local development

Each D1-backed app needs a `.dev.vars` file with `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`, and the local URLs:

```env
# scheduler/.dev.vars
RP_SESSION_SECRET=…
IDP_CLIENT_SECRET=…
APP_URL=http://localhost:5176
ACCOUNTS_URL=http://localhost:5173
IDP_URL=http://localhost:5173
```

`accounts/.dev.vars` additionally needs `IDP_SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, and one `<APP>_CLIENT_SECRET` per OAuth client (`TINYURL_CLIENT_SECRET`, `WIKI_CLIENT_SECRET`, `IMG_CLIENT_SECRET`, `SCHEDULER_CLIENT_SECRET`). After changing any client secret/id/redirect, hit `/admin/seed-clients` so the IdP re-seeds `OAUTH_KV`. Dev ports are `5173` (accounts), `5174` (tinyurl), `5175` (img), `5176` (scheduler), `5177` (wiki).

## CI / Deploy

- `.github/workflows/ci.yml` — runs lint, typecheck, unit tests, build, and Playwright as separate jobs on Node 20 + pnpm. Keep all five green.
- `.github/workflows/deploy.yml` — on push to `main`, deploys `accounts`, `tinyurl`, `img`, and `scheduler` to Cloudflare Workers via `wrangler-action`.

See [`CLAUDE.md`](./CLAUDE.md) for conventions (Biome, Conventional Commits, type-only imports, `~/*` alias, etc.) and notes for Claude Code agents.
