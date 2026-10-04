# TinyURL architecture

| Responsibility | Code |
| --- | --- |
| HTTP adapters and public URLs | `app/routes/<domain>/`, `app/routes/api/cli/<domain>/`; registration in `app/routes.ts` |
| Domain-free UI primitives and branding | `app/components/ui/`, `app/components/gdg-mark.tsx`, `app/components/status-badge.tsx` |
| Common page shell, navigation, account menu | `app/layouts/` |
| Composed screens, metadata, loader/action adapters | Registered modules directly in `app/routes/<domain>/` |
| Domain widgets and forms | `app/features/<domain>/components/` |
| Link model, CRUD, queries, sharing, comments | `app/features/links/link-record.ts`, `link.repository.ts`, `link-queries.ts`, `link-permissions.repository.ts`, `link-comments.repository.ts` |
| Link creation/update orchestration and validation | `app/features/links/link.service.ts`, `link-policy.ts`; form DTO in `link-http.types.ts` |
| Redirect fast path and OGP | `app/features/links/redirect-handler.ts`, `ogp.ts`; invoked from `workers/app.ts` and slug route |
| Campaigns, channels, source assignment, connpass import/acquisition | `app/features/campaigns/`; campaign-link SQL in `campaign-links.repository.ts` |
| Folder model, ACL, permissions/mutations | `app/features/folders/folder-record.ts`, `folder-access.repository.ts`, `folder.repository.ts` — browser and CLI share the same implementation |
| Tags and link-tag association | `app/features/tags/tag-record.ts`, `tag.repository.ts`, `link-tags.repository.ts` |
| Custom domain registration, provider, gateway signatures | `app/features/domains/` |
| Analytics Engine queries/events, filters and charts | `app/features/analytics/` |
| RP/session/chapter claims, CLI authorization and cached user lookup | `app/features/auth/` |
| CLI HTTP envelopes, request parsing and installer | `app/features/cli-api/` |
| Dashboard display preferences | `app/features/dashboard/display-preferences.ts`, `components/display-menu.tsx` |
| Transport input contract | `app/http/request.ts` |
| Neutral helpers | `app/lib/utils.ts`, `use-media-query.ts` |
| Worker integration | `workers/app.ts`, `workers/context.ts` |
| Schema/configuration | `migrations/`, `wrangler.toml` — `schema.sql` and Worker types are generated |

- Registered route modules own page composition and loader/action adapters in the same file. Routes compose widgets and layouts; features contain domain code and widgets and do not import routes, including route types. There is no `features/*/pages/` or `_pages/` hierarchy.
- Widgets use only type imports from `*.server.ts`. Routes can import server handlers for loader/action exports; the production build verifies React Router's client/server separation. Shared form response types belong to the feature, not its route module.
- Concrete repository modules own SQL and row conversion. There is no cross-domain `lib/db.ts` facade or duplicate browser/CLI folder/tag persistence implementation.
- `tests/architecture/layering.test.ts` guards dependency directions, client/server imports, the neutral-helper inventory, and public URLs. Existing redirect, sharing, assignment, import, analytics, and CLI tests remain with their owning code.
- Update this map and adjacent tests whenever ownership or paths change.
