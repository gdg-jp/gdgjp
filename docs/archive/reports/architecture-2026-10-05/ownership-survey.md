# Architecture ownership survey, October 5, 2026

The October 5, 2026 survey found these responsibilities needing explicit ownership:

| Application | Structural issue found | Ownership to make explicit |
| --- | --- | --- |
| [accounts](../../../../apps/accounts/ARCHITECTURE.md) | Identity, OAuth, onboarding, administration, and unrelated D1 queries mixed in `lib` | Authentication, OAuth, developer applications, chapters, memberships, users, onboarding, Google Workspace, notifications |
| [tinyurl](../../../../apps/tinyurl/ARCHITECTURE.md) | Partial features coexist with a 1,144-line database facade, scattered analytics, and large page modules | Links, campaigns, analytics, domains, folders, tags, authentication, CLI adapters, dashboard |
| [img](../../../../apps/img/ARCHITECTURE.md) | Image/folder features depend on domain-specific `lib` and shared component directories | Image delivery and mutation, folders, authentication, HTTP adapters |
| [scheduler](../../../../apps/scheduler/ARCHITECTURE.md) | Event, slot, participant, availability, and participant-cookie behavior mixed together | Events/scheduling, participants, authentication |
| [sns](../../../../apps/sns/ARCHITECTURE.md) | Partial features coexist with a mixed database module and route-owned publishing/settings workflows | Posts, contributors, X accounts, Google Photos, authentication, CLI adapters |
| [connpass](../../../../apps/connpass/ARCHITECTURE.md) | Browser session, automation, jobs, and authorization mixed in `lib`; jobs and runner import each other | Authorization, browser integration, automation operations, job contracts/storage/execution |
| [pay](../../../../apps/pay/ARCHITECTURE.md) | Profiles, events, claims/items, Google tokens, and transactions share one database module | Profiles, events, claims, receipts, Google integration, authentication |
| [ost](../../../../apps/ost/ARCHITECTURE.md) | Live board protocol/calculations, event registry, geometry, and authentication mixed in `lib` | Board, event registry/access, layout, authentication; Durable Object remains the runtime boundary |
| [agent](../../../../apps/agent/ARCHITECTURE.md) | Plain Worker; the v1 apps/agents feature split carried over | Webhook verification, account linking, chat adapters, inquiry (reader choice, bundle, degraded replies), filing, telemetry |
| [tinyurl-gateway](../../../../apps/tinyurl-gateway/ARCHITECTURE.md) | One edge handler owns configuration, caching, upstream validation, and proxying | Configuration/cache, trusted upstream requests, request proxy, Vercel adapter |
| [agents-index](../../../../apps/agents-index/ARCHITECTURE.md) | Socket lifecycle and JSON-RPC dispatch share the daemon module | Daemon transport, request dispatch, ACL-aware search, indexing; deployment entrypoints stay explicit |
| [accounts-oidc-client-demo](../../../../apps/accounts-oidc-client-demo/ARCHITECTURE.md) | One Worker module owns OIDC flows, encrypted cookies, configuration, and HTML | OIDC/session behavior, cookie encryption, presentation, Worker routing |
| [website](../../../../apps/website/ARCHITECTURE.md) | Already small: shared site layout, public pages, and apex routing | Public pages, application-directory widget, shared layout, and the website/TinyURL boundary |
| [go-extension](../../../../apps/go-extension/ARCHITECTURE.md) | Already small: browser listeners and pure URL rules are separated | Preserve that separation and verify packaging includes imported modules |

In that migration, `wiki/` was the reference, and `roster/`, shared libraries, CLI,
and agent-host were excluded as independent refactoring targets. These were delivery
boundaries for that migration, not permanent exclusions from architecture work.
For new changes, use current application ownership and local instructions. Generated
host assets must still be synchronized if an included source changes.
