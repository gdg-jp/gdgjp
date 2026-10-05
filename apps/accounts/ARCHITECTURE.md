# Accounts architecture

| Responsibility | Location |
| --- | --- |
| React Router URLs and HTTP entrypoints | `app/routes.ts`, `app/routes/` |
| Composed screens and their loader/action/meta exports | `app/routes/<domain>/` |
| Composed application layouts and navigation | `app/layouts/` |
| Domain-free reusable visual primitives | `app/components/` (brand mark, page heading, locale and theme controls) |
| Better Auth provider, sessions, redirects and runtime initialization | `app/features/auth/` |
| Device grants, CLI bearer tokens, logout and trusted-client seeding | `app/features/oauth/` |
| Developer OAuth client ownership, validation and management | `app/features/developer-apps/` |
| Chapter directory, regional classification and chapter administration | `app/features/chapters/` |
| Membership queries, atomic mutations, requests and chapter management | `app/features/memberships/` |
| User lookup and super-admin user management | `app/features/users/` |
| Onboarding policy, skip cookie and chapter selection wizard | `app/features/onboarding/` |
| Account dashboard | `app/features/dashboard/` |
| Membership email notifications | `app/features/notifications/` |
| Independent Google Workspace OAuth linking, encryption and token vending | `app/features/google-workspace/` |
| Shared crypto, typed request/data boundaries and localization | `app/lib/` |
| Worker fetch boundary and initial trusted-client setup | `workers/app.ts` |
| Database evolution | `migrations/` (`schema.sql` is generated) |

- Frontend code has three categories: reusable domain-free primitives in `app/components/`, domain widgets in `app/features/<domain>/components/`, and composed screens directly in `app/routes/<domain>/`. Shared application layouts live in `app/layouts/`.
- Domain route modules compose screens and connect their generated framework arguments to feature request handlers. They retain the public URL, HTTP response, metadata and route-export contracts.
- Each feature owns its server code, client-safe types, widgets and unit tests. Screens compose these features beneath routes. Import concrete modules; do not add compatibility re-export facades.
- D1 queries are split by chapter, membership and user responsibility. Membership mutations keep atomic last-organizer checks in `mutations.server.ts`; joined-row mapping is server-only. Chapter/membership types remain client-safe.
- Feature request handlers use `lib/route-args.ts` to retain the typed Cloudflare application context. Domain widgets infer serialized data through `lib/route-data.ts`; route screens retain their generated `+types` contract.
- `.server.ts` modules may be imported by UI only with `import type`. Lower-level widgets do not depend on screens. Features never import routes, and runtime imports are acyclic.
- `app/architecture.test.ts` enforces these placement/import boundaries. Existing adjacent tests cover OAuth authorization, device grants, membership safeguards, Workspace encryption/token vending and route behavior.
