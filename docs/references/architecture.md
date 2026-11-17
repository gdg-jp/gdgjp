# Application architecture

Each application's `ARCHITECTURE.md` is its code map. `apps/wiki/ARCHITECTURE.md` and
`docs/plans/wiki-refactoring/index.md` provide the reference for feature ownership;
applications use only the layers their existing responsibilities need.

## Placement and dependencies

- Put domain logic, data access, UI, and their tests together under a named feature.
  React Router applications use `app/features/<domain>/`.
- Keep `app/lib/` for domain-independent primitives. Frontend UI has three explicit
  categories: `app/components/` for reusable domain-independent components,
  `app/features/<domain>/components/` for domain-aware widgets, and
  `app/routes/<domain>/` for screens composed from those widgets.
  Shared application shells and composed layouts belong in `app/layouts/`.
- Route modules compose screens and own their HTTP handlers and metadata together.
  Put them directly under `app/routes/<domain>/`; a separate page directory and
  a forwarding module solely to render that screen add no responsibility boundary.
  Features contain domain logic and widgets and must not import route modules.
  Route registration and public URLs remain framework-owned.
- Worker, Next, Vercel, and extension entrypoints compose runtime adapters. Runtime
  integration must not leak into browser-safe domain types and calculations.
- Data access modules own queries for their domain. Callers import concrete modules;
  a legacy all-purpose database module must not become a forwarding facade.
- Mark server-only modules with `.server.ts` where the framework uses that boundary.
  Type-only imports must not pull server implementations into client bundles.
- Extract substantial responsibilities, rather than dividing files at an arbitrary
  line count. Small applications do not need empty layers or generic interfaces.
- Keep tests alongside their subject. Architecture tests check dependency direction,
  runtime boundaries, and unchanged public entrypoints where relevant.
- Keep genuinely shared authentication/cookie code in `gdg-lib/` and design-system
  primitives in `design-system/`. Similar-looking application code alone does not justify a
  shared package.

## Verification

Use scoped checks while editing each application. After integration, run repository
`pnpm ci:quick` and the relevant local browser suites. Treat authenticated external
services and live connpass browser automation as separate acceptance paths; local
fixtures do not demonstrate production behavior.

Refactoring must preserve public URLs, request/response contracts, authorization,
cookie formats, queue retry behavior, and deployment entrypoint exports. Schema migrations and new runtime dependencies require a separately scoped change
and the application-specific checks.

The October 5 migration scope and its validation results are historical records.
See [the ownership survey](../archive/reports/architecture-2026-10-05/ownership-survey.md) and
[software-architecture-verification.md](../archive/reports/architecture-2026-10-05/verification.md).
