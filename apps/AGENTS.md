# Application conventions

Read the application's local `AGENTS.md` and `ARCHITECTURE.md`; see
`../docs/applications.md` for the application directory. Paths below are app-relative
unless explicitly prefixed with `apps/` or `packages/`.

## Architecture

Follow `../docs/references/architecture.md` (relative to this file). Application code is
feature-first: domain logic, data access, widgets, and tests belong in
`app/features/<domain>/`; `app/lib/` contains domain-independent primitives.
Use `app/components/` for domain-free components, `app/features/<domain>/components/`
for domain widgets, `app/routes/<domain>/` for composed screens, and `app/layouts/`
for shared composed shells. Follow the existing wiki and roster code maps.

Routes own screen composition and HTTP handlers together. Do not add a separate page
directory or a forwarding module solely to render a screen. Features must not import routes.
Preserve framework entrypoints and public URLs when moving modules. Keep code app-local
unless genuinely shared in `packages/gdg-lib/`.

## React Router and Workers

These conventions apply to React Router Worker apps, not the Go CLI, Chrome extension,
Vercel gateway, or standalone plain Workers:

- Routes use dotted names (for example, `chapters.$slug.organize.tsx`) and registration
  in `app/routes.ts`. Worker integration belongs in `workers/`; access bindings through
  `context.cloudflare`. Static assets normally live in `public/`.
- Unit tests live beside their subject as `*.test.ts` / `*.test.tsx`; Playwright suites
  live in `e2e/`. D1 migrations live in `migrations/`; `schema.sql` is generated.
- Apps provide `cf-typegen`, `migrate:local`, and `migrate:remote` scripts. After changing
  `wrangler.toml` bindings, run the app's `cf-typegen` or `typecheck` to refresh types.
  The standalone OIDC demo uses `wrangler.jsonc` and has no D1 migrations.

Relying-party `.dev.vars` need `RP_SESSION_SECRET` and `IDP_CLIENT_SECRET`; accounts also
needs its identity-provider and client secrets. When an Accounts OAuth client secret,
ID, or redirect URI changes, reseed client data through `/admin/seed-clients` before testing.

## UI and design harness

Before UI work, read `packages/design-system/DESIGN.md` → `Harness` (repository-root path).
The contracts live in `design/` in that submodule; use its `design-build`, `design-review`,
and `design-improve` skills and the `gdg-design` MCP server as appropriate.
From the repository root, `node scripts/check-design-harness.mjs` runs `source` static
rules on changed app TSX and `scenarios` checks for every scenario. Existing violations
block a file once touched. The pre-commit hook and CI run both when app TSX or the
design-system submodule changes.
