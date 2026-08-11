# Contributing to gdgjp

Thank you for contributing. This repository uses pnpm workspaces and Turborepo.
Apps, including the public `website/` and social-post management `sns/` services, are React Router
v7 SSR applications deployed to Cloudflare Workers.

## Prerequisites

- Node.js 20 or later
- pnpm 9.15.0 (the version declared in `package.json`)

## Set up local development

From the repository root, install dependencies and start all application development servers:

```sh
pnpm install
pnpm dev
```

Each D1-backed application needs a `.dev.vars` file containing `RP_SESSION_SECRET`,
`IDP_CLIENT_SECRET`, and its local URLs. For example:

```env
# scheduler/.dev.vars
RP_SESSION_SECRET=…
IDP_CLIENT_SECRET=…
APP_URL=http://localhost:5176
ACCOUNTS_URL=http://localhost:5173
IDP_URL=http://localhost:5173
```

`accounts/.dev.vars` also needs `IDP_SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, and an
`<APP>_CLIENT_SECRET` for every OAuth client: `TINYURL_CLIENT_SECRET`,
`WIKI_CLIENT_SECRET`, `IMG_CLIENT_SECRET`, `SCHEDULER_CLIENT_SECRET`, and `SNS_CLIENT_SECRET`.
After changing a client secret, ID, or redirect URI, open `/admin/seed-clients` to reseed
`OAUTH_KV`.

Development ports are `5173` (accounts), `5174` (tinyurl), `5175` (img), `5176`
(scheduler), `5177` (wiki), `5178` (sns), `5179` (connpass), and `5180` (website).

`sns/.dev.vars.example` lists its additional X and Google Photos credentials. The public
`website/` does not require a `.dev.vars` file for local development.

## Common commands

Run these from the repository root. Turborepo runs applicable commands across workspaces.

```sh
pnpm build        # production builds
pnpm typecheck    # Worker types, React Router types, and TypeScript checks
pnpm test         # unit tests
pnpm test:e2e     # Playwright end-to-end tests
pnpm lint         # Biome checks
pnpm lint:fix     # apply Biome fixes
pnpm format       # format with Biome
```

To run a command for one app, use a pnpm filter:

```sh
pnpm --filter @gdgjp/scheduler dev
pnpm --filter @gdgjp/scheduler test
pnpm --filter @gdgjp/scheduler migrate:local    # apply D1 migrations locally
pnpm --filter @gdgjp/scheduler migrate:remote   # apply D1 migrations to production
```

D1-backed apps provide `migrate:local` and `migrate:remote` scripts. `website/`, `gdg-lib/`,
`tinyurl-gateway/`, `go-extension/`, and `accounts-oidc-client-demo/` do not have D1 migrations.

## Before opening a pull request

Run the narrowest relevant test while iterating, then run:

```sh
pnpm lint
pnpm typecheck
pnpm test
```

Run `pnpm test:e2e` when the change affects user-facing behavior. Use Conventional Commit-style
subjects and scope them by package where practical, for example `feat(tinyurl): add analytics`.

The CI workflow runs lint, typecheck, unit tests, builds, and Playwright separately. Pull requests
should describe the change, list validation performed, link related issues, and include screenshots
for UI changes. Call out any Cloudflare binding, migration, or `.dev.vars.example` changes.

## Project conventions

Biome enforces 2-space indentation, double quotes, semicolons, trailing commas, and a 100-character
line width. Use TypeScript and ESM, prefer `import type` for type-only imports, and keep code within
its app unless it is genuinely shared through `gdg-lib`.

See [`CLAUDE.md`](./CLAUDE.md) for additional repository conventions and agent notes.
