# Architecture refactor verification — October 5, 2026

Verification base revision: `7f578933`.

## Scope

Application writers investigated and edited accounts, tinyurl, img, scheduler, sns,
connpass, pay, ost, agents, agents-index, tinyurl-gateway, the OIDC demo, website,
and go-extension. The extension already separated its Chrome adapter from pure
URL rules; its change is an architecture guide, with packaging verified.

Wiki was the reference. Roster, shared libraries, CLI, and agent-host were excluded
as refactoring targets. CLI's embedded agents-index source files and layout golden
inventory were regenerated to preserve distribution of the included service;
no CLI or agent-host implementation was refactored.

## Structural checks

- Frontend primitives, domain widgets, and composed pages have distinct ownership.
  Composed React screens belong directly in `app/routes/<domain>/`; features contain
  domain logic and widgets. Application-wide composed layouts have their own directory.
- Mixed database modules were replaced by concrete domain queries and types;
  callers use their owning modules rather than legacy forwarding facades.
- Independent review checked 679 application TypeScript files, including runtime
  re-exports: no cycles, widget/layout-to-server runtime imports, feature-to-route
  dependencies, or generic-component-to-feature dependencies were found. Registered
  route modules use server imports for loader/action exports; 74 TSX route modules'
  server-function references were also reviewed.
- A separate TypeScript AST comparison preserved all 170 explicit route paths in
  nine React Router applications. Application tests also cover URL registration.
- Review found a TinyURL runtime import of a server-only pagination constant;
  it was removed. Pay's feature dependencies on generated route types were removed.
- Final taxonomy audit extracted Scheduler's generic ShareUrl and SNS's generic
  blurhash placeholder, photo widget, and account-revocation widget from screens.
  TinyURL's duplicate FieldLabel wrappers became one generic primitive; its
  membership-required and not-found screens are separate route-owned compositions.

## Validation

The integrated Turbo test graph passed all 21 tasks across 19 packages. The 14 target
application suites passed 1,005 tests in the final integrated logs; tests cover existing
behavior and new boundaries.

| Application | Passing unit tests | Local browser verification |
| --- | ---: | --- |
| accounts | 201 | 2 Chromium tests passed |
| tinyurl | 279 | 2 local IdP redirect tests passed |
| img | 85 | 2 tests passed after applying existing local D1 migrations |
| scheduler | 43 | 1 Chromium test passed |
| sns | 112 | No existing Playwright configuration or suite |
| connpass | 29 | 17 tests passed using mock IdP and local D1 |
| pay | 28 | No existing browser suite; Google/Gemini/email mocked |
| ost | 42 | 6 local Worker tests passed |
| agents | 119 | Next production routes built; no browser suite |
| agents-index | 15 | RPC auth/output boundaries tested; no browser UI |
| tinyurl-gateway | 28 | Signed requests, DNS safety, and forwarding tested |
| OIDC demo | 6 | OIDC flow mocked; crypto and HTML escaping tested |
| website | 16 | SSR output tested; no existing browser suite |
| go-extension | 2 | Built manifest assets and imported-module closure verified |

- `pnpm lint`: passed; existing broken `.codex/skills/sdd-implement` symlink warning.
- `pnpm run typecheck`: passed, including node scripts and all 21 Turbo tasks.
- Integrated build: all 18 applicable Turbo tasks passed.
- After merging all 54 React screen compositions with their registered HTTP route
  modules directly under `routes/<domain>/`, `turbo typecheck test build
  --concurrency=3` passed all 56 combined tasks (29 cached). The separate screen
  directories and forwarding modules have been removed.
  Repository lint passed; the earlier local E2E results cover unchanged screen
  bodies and URLs. The placement correction did not repeat browser suites.
- `go test ./internal/agenthost -count=1`: 115 tests passed after asset synchronization.
- `git diff --check`: passed.

## Whole-repository blockers and limits

- `pnpm ci:quick` passed node-script types and lint, then stopped on existing
  roster UI convention violations. Every reported UI violation belongs to roster,
  which was excluded and remains unchanged.
- `pnpm test` stopped in the script suite because
  `gdg agent-host apply prefix mode writes layout` asserts that `skills-lock.json`
  does not exist. That file is tracked at the base revision (introduced in
  `8a9118bd`), independent of this refactor. The application Turbo test graph was
  run separately and passed.
- Local tests do not establish live Google, Gemini, email, Vercel, or connpass.com
  behavior. No deployment, external publishing, or production migration was run.
- Img's initial E2E run failed because local D1 had no image tables, with concurrent
  cold workerd startup also producing SQLite lock errors. Existing local migrations
  and serialized verification resolved it without changing application behavior.
- TinyURL's local IdP redirect tests passed after example-based temporary local
  variables, existing local D1 migrations, and local OAuth-client seeding. Temporary
  variables and seed SQL were removed. No production credentials or services were used.

## Commit checks

The commit gate exposed a reproducible Img dev-proxy startup race: probing only
a static asset allowed parallel first requests to initialize multiple local
Cloudflare runtimes. Its browser readiness probe now uses anonymous session
inspection, which initializes the proxy without accessing an IdP or D1. Both
parallel Img tests passed after this change.

The changed-file CI map now includes pay, agents, and agents-index. It schedules
browser checks only where a Playwright configuration exists; applications without
a browser suite retain their type, unit-test, and build checks. Nineteen focused
CI-selection regression tests passed.
