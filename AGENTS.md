# Repository Guidelines

## Project Structure & Module Organization

This is a flat pnpm/Turborepo monorepo. The workspace packages are listed in
`pnpm-workspace.yaml`:

- `accounts/` is the GDG Accounts OAuth/OIDC identity provider on Cloudflare Workers, backed by
  D1 and KV.
- `tinyurl/`, `img/`, `scheduler/`, `sns/`, `connpass/`, `pay/`, and `wiki/` are React Router v7 SSR
  Cloudflare Workers and relying parties of `accounts/` (connpass is Bearer-API oriented for
  CLI/agents; `ost/` below is a relying party for its admin surfaces only). They keep routes in
  `app/routes/`, route registration in `app/routes.ts`, Worker entrypoints in `workers/`, and D1
  migrations in `migrations/`.
  `wiki/` additionally uses R2, Queues, Browser Rendering, Workers AI, Vectorize, and a Durable
  Object; `img/` uses R2 and Cloudflare Images; `sns/` uses D1, R2, scheduled publishing, and X
  and Google Photos integrations; `connpass/` uses D1, KV, Queues, and Browser Run for connpass.com
  admin automation; `pay/` uses D1, R2, Gemini receipt extraction, and Google Sheets/Drive sync.
- `website/` is the public GDG Japan React Router v7 SSR website on Cloudflare Workers. It uses a
  TinyURL service binding and has no D1 database.
- `ost/` is the Open Space Technology support app (`ost.gdgs.jp`): per-event topic collection,
  participant voting, a venue desk-layout editor, projector screens, and auto-assignment of
  top-voted topics to desks. React Router v7 SSR on Cloudflare Workers. Public participant pages
  live at `/:slug`; all admin surfaces (dashboard, screens, editor) are `accounts/` relying-party
  routes gated by GDG chapter membership. D1 (`DB`) holds only auth tables + an `events` registry;
  each event's live state (topics, votes, merge groups, desks) is one per-slug Durable Object
  (`OstBoard`, SQLite storage + hibernatable WebSockets, `getByName(slug)`).
- `discord-relay/` is the Discord event relay control plane (`relay.gdgs.jp`): bot invitation,
  event filtering and webhook forwarding rules, delivery tracking, and dead-letter queue management.
  React Router v7 SSR on Cloudflare Workers and a relying party of `accounts/`. D1 (`DB`) holds
  auth tables, chapter caches, and audit logs.
- `gdg-lib/` is the source-only shared TypeScript package (`@gdgjp/gdg-lib`) for relying-party
  auth and signed-cookie helpers. Keep code app-local unless it is genuinely shared here.
- `agents-index/` is the local, ACL-filtered semantic navigation MCP service for the shared wiki
  worktree. Its results must never include indexed document text.
- `tinyurl-gateway/` is a Vercel Edge gateway for TinyURL custom domains.
- `go-extension/` is a Manifest V3 Chrome extension.
- `accounts-oidc-client-demo/` is a standalone Cloudflare Worker demonstrating an OIDC relying
  party; it does not use D1, KV, or service bindings.

`cli/` contains the Go-based `gdg` CLI and is not a pnpm workspace. Repository automation lives
in `scripts/`; supporting documentation lives in `docs/`.

Static assets are normally in `public/`. Unit tests live beside the code they cover as
`*.test.ts` or `*.test.tsx`; Playwright tests live in each app's `e2e/` directory. `schema.sql`
files are generated from migrations: edit migrations, not the generated dump.

## Build, Test, and Development Commands

Run commands from the repository root unless a single workspace is in scope.

- `pnpm dev`, `pnpm build`, `pnpm deploy`, and `pnpm typecheck` run applicable Turborepo tasks.
- `pnpm lint`, `pnpm lint:fix`, and `pnpm format` run Biome.
- `pnpm test` runs repository script tests and workspace Vitest tests.
- `pnpm test:e2e` runs workspace Playwright tests serially.
- `pnpm ci:quick` runs Biome and Vitest tests.
- `pnpm ci:full` runs `ci:quick` + workspace Playwright tests serially.

Prefer `ci:quick` and `ci:full` than specific commands during development.
Use specific commands only when fixing CI errors.

Use package filters for focused work, for example:

```sh
pnpm --filter @gdgjp/scheduler test
pnpm --filter @gdgjp/wiki test:golden
pnpm --filter @gdgjp/tinyurl migrate:local
pnpm --filter @gdgjp/go-extension build
```

React Router Worker apps provide `cf-typegen`, `migrate:local`, and `migrate:remote` scripts.
After modifying a `wrangler.toml` binding, run that app's `cf-typegen` or `typecheck` to refresh
Worker types. The OIDC demo uses `wrangler.jsonc` and has no D1 migrations.

## Coding Style & Naming Conventions

Use TypeScript and ESM. Biome enforces 2-space indentation, double quotes, semicolons, trailing
commas, and a 100-character line width. TypeScript uses `verbatimModuleSyntax` and
`isolatedModules`; use `import type` and `export type` for type-only symbols.

React Router route files use the framework's dotted naming conventions, such as
`chapters.$slug.organize.tsx`. In Worker apps, keep Worker integration in `workers/` and access
bindings through `context.cloudflare`. Do not hand-edit generated Worker configuration types or
generated schema dumps.

## Testing Guidelines

Run the narrowest relevant test during development, then run `pnpm lint`, `pnpm typecheck`, and
`pnpm test`. Run `pnpm test:e2e` for user-facing changes. For a single Vitest or Playwright test,
use the relevant workspace, for example
`pnpm --filter @gdgjp/accounts exec vitest run path/to/test.ts`.

## Commit & Pull Request Guidelines

Use Conventional Commit-style subjects scoped by package where practical, for example
`feat(accounts): add client management`. PRs should describe the change, list validation run,
link related issues, and include screenshots for UI changes. Call out Cloudflare binding,
migration, deployment, or `.dev.vars.example` changes.

## Security & Configuration Tips

Do not commit `.dev.vars*`, secrets, generated Worker types, build output, Playwright reports, or
local Wrangler state. Store Cloudflare secrets with `wrangler secret put`; keep Vercel runtime
secrets in the Vercel project environment.

Relying-party `.dev.vars` files need `RP_SESSION_SECRET` and `IDP_CLIENT_SECRET`. `accounts/`
also needs its identity-provider and client secrets. When an Accounts OAuth client secret, ID, or
redirect URI changes, reseed its client data through `/admin/seed-clients` before testing the
integration.
