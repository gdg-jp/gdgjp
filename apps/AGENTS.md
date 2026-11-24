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
for shared composed shells.

Routes own screen composition and HTTP handlers together. Do not add a separate page
directory or a forwarding module solely to render a screen. Preserve framework entrypoints
and public URLs when moving modules. Move code to `packages/gdg-lib/` only when more than
one app genuinely needs it.

## Checked conventions

`pnpm check:boundaries` ([policy](../docs/engineering/workspace-boundaries.md)) and
`pnpm check:apps` ([policy](../docs/engineering/app-conventions.md)) enforce import
ownership, migrations and generated `schema.sql`, relying-party registration, dev ports,
cron dispatch, binding access, and test placement. Their messages say how to fix a failure.

After an Accounts OAuth client secret, ID, or redirect URI changes, reseed client data
through Accounts' `/admin/seed-clients` before testing.

## UI and design harness

Before UI work, read `packages/design-system/DESIGN.md` → `Harness` (repository-root path).
The contracts live in `design/` in that submodule; use its `design-build`, `design-review`,
and `design-improve` skills and the `gdg-design` MCP server as appropriate.
`node scripts/check-design-harness.mjs` (run by the pre-commit hook and CI) applies its rules.
