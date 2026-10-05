# Scheduler architecture

| Responsibility | Location |
| --- | --- |
| OIDC configuration, session access, return-target validation | `app/features/auth/` |
| Event lifecycle, owner authorization, form validation | `app/features/events/manage.server.ts`, `repository.server.ts`, `validate.ts` |
| Event aggregate read model (one D1 batch) | `app/features/events/bundle.server.ts` |
| Weekly slot model, persistent slot reconciliation | `app/features/scheduling/slots.ts`, `reconcile.ts`, `repository.server.ts` |
| Schedule editor and slot grid | `app/features/scheduling/components/` |
| Participant identity, availability, response mutations | `app/features/participants/event.server.ts`, `repository.server.ts`, `participant-cookie.ts` |
| Public event view and response UI | `app/routes/participants/event.tsx` |
| HTTP handlers and page composition | `app/routes/` (URLs stay in `app/routes.ts`) |
| Composed application shell / header | `app/layouts/` |
| App-owned brand mark and URL sharing | `app/components/` |
| Event creation, owner list and edit screens | `app/routes/events/` |
| Shared UI controls, theme and CSS class helpers | `@gdgjp/design-system` |
| Worker runtime boundary | `workers/app.ts` |

- Domain types live in each feature's `model.ts`; database rows and mapping stay in server repositories.
- Registered route modules in `app/routes/<domain>/` own metadata, loader/action adapters and their composed screens together. No forwarding page modules or extra page folders. Features contain domain logic and widgets, never pages.
- Features import concrete modules, never route modules or generated route types. Routes pass request, environment and route parameters into feature services.
- `*.server.ts` owns D1/session operations. Components may import server **types** only, never runtime server code.
- Event management composes slot persistence. Participant response orchestration composes the event read model. No common database grab-bag or compatibility barrels remain.
- Anonymous identity remains a per-event HttpOnly token cookie with only its hash stored in D1. A signed-in identity takes priority over cookies; owner mutations enforce owner IDs before writes.
- Unit tests sit beside their modules. `app/architecture.test.ts` guards placement, route independence, client/server imports and public paths.
- Update this map when moving a responsibility. Migrations, bindings and public URLs are outside this refactor.
