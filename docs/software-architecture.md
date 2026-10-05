# Application architecture

Each application's `ARCHITECTURE.md` is its code map. `wiki/ARCHITECTURE.md` and
`docs/wiki-refactoring/index.md` provide the reference for feature ownership;
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

## Survey and ownership

The October 5, 2026 survey found these responsibilities needing explicit ownership:

| Application | Structural issue found | Ownership to make explicit |
| --- | --- | --- |
| [accounts](../apps/accounts/ARCHITECTURE.md) | Identity, OAuth, onboarding, administration, and unrelated D1 queries mixed in `lib` | Authentication, OAuth, developer applications, chapters, memberships, users, onboarding, Google Workspace, notifications |
| [tinyurl](../apps/tinyurl/ARCHITECTURE.md) | Partial features coexist with a 1,144-line database facade, scattered analytics, and large page modules | Links, campaigns, analytics, domains, folders, tags, authentication, CLI adapters, dashboard |
| [img](../apps/img/ARCHITECTURE.md) | Image/folder features depend on domain-specific `lib` and shared component directories | Image delivery and mutation, folders, authentication, HTTP adapters |
| [scheduler](../apps/scheduler/ARCHITECTURE.md) | Event, slot, participant, availability, and participant-cookie behavior mixed together | Events/scheduling, participants, authentication |
| [sns](../apps/sns/ARCHITECTURE.md) | Partial features coexist with a mixed database module and route-owned publishing/settings workflows | Posts, contributors, X accounts, Google Photos, authentication, CLI adapters |
| [connpass](../apps/connpass/ARCHITECTURE.md) | Browser session, automation, jobs, and authorization mixed in `lib`; jobs and runner import each other | Authorization, browser integration, automation operations, job contracts/storage/execution |
| [pay](../apps/pay/ARCHITECTURE.md) | Profiles, events, claims/items, Google tokens, and transactions share one database module | Profiles, events, claims, receipts, Google integration, authentication |
| [ost](../apps/ost/ARCHITECTURE.md) | Live board protocol/calculations, event registry, geometry, and authentication mixed in `lib` | Board, event registry/access, layout, authentication; Durable Object remains the runtime boundary |
| [agents](../apps/agents/ARCHITECTURE.md) | Flat modules mix chat runtime, inquiry, filing, OAuth, webhooks, and telemetry; inquiry/filing dependencies form a cycle | Chat/inquiry orchestration, filing, account linking, webhook verification, provider tools, observability |
| [tinyurl-gateway](../apps/tinyurl-gateway/ARCHITECTURE.md) | One edge handler owns configuration, caching, upstream validation, and proxying | Configuration/cache, trusted upstream requests, request proxy, Vercel adapter |
| [agents-index](../apps/agents-index/ARCHITECTURE.md) | Socket lifecycle and JSON-RPC dispatch share the daemon module | Daemon transport, request dispatch, ACL-aware search, indexing; deployment entrypoints stay explicit |
| [accounts-oidc-client-demo](../apps/accounts-oidc-client-demo/ARCHITECTURE.md) | One Worker module owns OIDC flows, encrypted cookies, configuration, and HTML | OIDC/session behavior, cookie encryption, presentation, Worker routing |
| [website](../apps/website/ARCHITECTURE.md) | Already small: shared site layout, public pages, and apex routing | Public pages, application-directory widget, shared layout, and the website/TinyURL boundary |
| [go-extension](../apps/go-extension/ARCHITECTURE.md) | Already small: browser listeners and pure URL rules are separated | Preserve that separation and verify packaging includes imported modules |

`wiki/` is the reference and is not part of this migration. `roster/` is excluded.
The shared libraries, CLI, and agent-host are not independent refactoring targets;
generated host assets must still be synchronized if an included source changes.

## Verification

Use scoped checks while editing each application. After integration, run repository
`pnpm ci:quick` and the relevant local browser suites. Treat authenticated external
services and live connpass browser automation as separate acceptance paths; local
fixtures do not demonstrate production behavior.

Refactoring must preserve public URLs, request/response contracts, authorization,
cookie formats, queue retry behavior, and deployment entrypoint exports. It must not
require a schema migration or a new runtime dependency.

Validation results and remaining repository-wide blockers are recorded in
[software-architecture-verification.md](software-architecture-verification.md).
