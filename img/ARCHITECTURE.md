# img architecture

| Responsibility | Location |
| --- | --- |
| Cookie sessions, chapter claims, Bearer identity, sign-in redirects | `app/features/auth/` |
| Image authorization and validation | `app/features/images/policy.ts`, `file.ts`, `slug.ts`, `id.ts` |
| Original upload and owner synchronization | `app/features/images/upload.server.ts`, `id.server.ts` |
| Gallery and detail page data | `app/features/images/gallery-page.server.ts`, `detail-page.server.ts` |
| Image listing and authorized lookup | `app/features/images/queries.server.ts` |
| Slug, chapter and folder changes, including atomic patches | `app/features/images/metadata.server.ts` |
| Byte replacement, mobile variants and deletion | `app/features/images/content.server.ts` |
| D1 and R2 persistence | `app/features/images/repository.server.ts`, `storage.server.ts`, `rendition-store.server.ts` |
| Public serving, negotiation and derived renditions | `app/features/images/serve.server.ts`, `delivery.server.ts`, `img-transform.ts`, `variant.ts`, `rendition-key.ts` |
| Image gallery, upload and edit controls | `app/features/images/components/` |
| Folder policy, D1 queries, use cases and folder navigation | `app/features/folders/` |
| HTTP endpoints and page composition | `app/routes/auth/`, `images/`, `api/images/`, `api/folders/`, `api/cli/`, `images/gallery.tsx` |
| Domain-free UI primitives and theme | `@gdgjp/design-system` |
| Composed gallery, detail and chapter onboarding pages | `app/routes/images/gallery.tsx`, `detail.tsx`, `app/routes/auth/no-chapter.tsx` |
| Common app shell and navigation | `app/layouts/` |
| Domain-free styling and HTTP cache helpers | `app/lib/http-cache.ts` |
| Worker entry and ImageUploadService RPC | `workers/` |

- Keep domain code and its tests together in `features/<domain>/`; import concrete modules directly.
- Server modules own bindings and persistence; pure policy, URL and transform modules also run in the browser.
- `auth/actor.ts` owns the authenticated identity shared by image and folder operations. Auth never depends on those domains.
- Images may use folder policy and repository; folders do not import the images feature.
- React Router route modules own `meta`, `loader`/`action` adapters and the default composed screen; features never import routes. No separate `_pages/` or feature `pages/` directories.
- Feature `components/` contain domain-aware widgets; registered route modules compose them and layouts. Page data and use cases stay inside features. React Router strips server imports used by loaders and actions from the client build. Domain-free primitives stay in `app/components/`; common composed shells stay in `app/layouts/`.
- `app/routes.ts` owns public URLs. File moves must preserve URL strings and update generated route types through typegen.
- `architecture.test.ts` guards primitive and shell ownership, dependency direction, cycles, client/server boundaries and the public URL set.
- Update this map when moving responsibilities. No forwarding barrels or app-specific additions to `app/lib/`.
