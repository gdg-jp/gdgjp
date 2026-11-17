# Repository guidelines

## Where to read next

- Applications live in `apps/`, shared libraries in `packages/`, automation in `scripts/`,
  and documentation in `docs/`. `apps/cli/` is Go and is outside the pnpm workspace.
- Read the ancestor and local `AGENTS.md` files for every directory you change, including
  when starting from the repository root. `apps/AGENTS.md` and `packages/AGENTS.md` hold
  their shared conventions. Local `CLAUDE.md` links to `AGENTS.md` where both use the same rules.
- Use [the application map](docs/applications.md) to find an application's purpose and services;
  read its `ARCHITECTURE.md` before changing module ownership or dependencies.
- Use [the verification reference](docs/engineering/verification.md) to distinguish
  automated checks, runtime journeys, and their coverage gaps.
- Before using a pstack skill, read [.agents/docs/pstack.md](.agents/docs/pstack.md) and
  the harness guide it names. Skills live in `.agents/skills/`.

## Commands and validation

Run commands from the repository root unless a single workspace is in scope.
Initialize `packages/design-system` with `git submodule update --init packages/design-system`
before installing dependencies. `apps/learn/`, `skills/`, and `packages/design-system/`
are separate Git submodules; make changes in the owning repository.

- `pnpm dev`, `pnpm build`, `pnpm deploy`, and `pnpm typecheck` run Turborepo tasks.
- `pnpm lint`, `pnpm lint:fix`, and `pnpm format` run Biome.
- `pnpm test` runs repository script tests and workspace Vitest tests.
- `pnpm test:e2e` runs workspace Playwright suites serially.
- Prefer `pnpm ci:quick` (Biome + Vitest) and `pnpm ci:full` (also Playwright) for development.
  Use package filters for focused work or diagnosing CI failures.
- Run the narrowest relevant check while editing, then `pnpm lint`, `pnpm typecheck`, and
  `pnpm test`. Run `pnpm test:e2e` for user-facing changes. Report any checks not run.

Automated browser regression suites use `pnpm test:e2e` locally and in CI.
For agent-driven runtime verification, use Orca Browser. Read the `orca-cli` skill and its
version-matched browser reference before driving a tab. Existing Playwright specs may supply
journeys and assertions; project verification skills must drive the browser through Orca.
Keep test servers and data isolated from development state.

## Style, security, and review

Use TypeScript and ESM. Biome enforces 2-space indentation, double quotes, semicolons,
trailing commas, and a 100-character line width. Use `import type` / `export type` for
type-only symbols (`verbatimModuleSyntax` and `isolatedModules` are enabled).

Do not add code comments by default. Express constraints in types, APIs, module boundaries,
or executable checks. Preserve necessary legal notices, public API contracts, and explanations
of externally imposed behavior. See [the comment policy](docs/engineering/comments.md) for
reviewed exceptions and the automatic check.

Do not commit `.dev.vars*`, secrets, generated Worker types, build output, Playwright reports,
or local Wrangler state. Do not hand-edit generated Worker types or `schema.sql` dumps;
edit migrations instead. Store Cloudflare secrets with `wrangler secret put` and Vercel
secrets in the project's environment.

Use Conventional Commit subjects scoped by package, such as `feat(accounts): add client management`.
PRs explain the change, link related issues, list validation, and include screenshots for UI changes.
Call out binding, migration, deployment, and `.dev.vars.example` changes.

## Maintaining these instructions

Keep this file limited to repository-wide rules and pointers. Put app-specific constraints
in that app's `AGENTS.md`, structural explanations in `ARCHITECTURE.md`, and reference material
in `docs/`. Keep pstack workflow details under `.agents/docs/`. Update the owning source
instead of copying rules into multiple harness-specific files. When adding local instructions,
link `CLAUDE.md` to `AGENTS.md` if both harnesses should read the same content.
