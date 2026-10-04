# SNS architecture

| Responsibility | Location |
| --- | --- |
| RP session, browser/CLI access, chapter selection, return paths | `app/features/auth/` |
| Post drafts, queries, media attachments, scheduling, X publishing, text/link metadata | `app/features/posts/` |
| Post cards and composer controls | `app/features/posts/components/` |
| Contributor policy, persistence, Accounts candidate search | `app/features/contributors/` |
| X account persistence, OAuth transactions, provider calls and token refresh | `app/features/x-accounts/` |
| Google Photos album settings, polling, import leases/uploads/completion, library selection | `app/features/google-photos/` |
| Google Photos library screen | `app/routes/google-photos/` |
| CLI JSON envelope, bounded body parsing, pagination and error mapping | `app/features/cli-api/` |
| Encryption, shared clock and chapter-label formatting | `app/lib/` |
| Domain-free BlurHash placeholder | `app/components/blurhash-placeholder.tsx` |
| Google Photos selection widget | `app/features/google-photos/components/google-photo-button.tsx` |
| X account revocation dialog | `app/features/x-accounts/components/revoke-x-account-dialog.tsx` |
| Application shell | `app/layouts/app-shell.tsx` |
| Post list and schedule screens | `app/routes/posts/` |
| Settings screen | `app/routes/settings/` |
| Settings loader composition | `app/features/settings/settings.server.ts` |
| URL registration and HTTP adapters | `app/routes.ts`, `app/routes/` |
| Worker fetch/cron composition and GitHub workflow dispatch | `workers/` |
| External browser importer running in GitHub Actions | `google-photos-importer/` |

- Each domain owns its concrete repository queries, types, services, components and colocated tests. Call concrete modules directly; do not recreate a shared database facade.
- Routes retain their public URLs and React Router generated types. Registered route modules own loader/action and screen composition; media adapters call feature handlers. SQL belongs to features.
- `*.server.ts` contains D1/R2 access, credentials and provider integrations. Client components use pure policies/types; type-only references to server handler return types do not enter the browser bundle.
- `workers/app.ts` composes the minute cron: post publishing and leased Google Photos album dispatch. Import HTTP endpoints and cron share `google-photos/importer.server.ts`; the HTTP route owns importer Bearer authorization.
- The scheduled publisher and manual publish-now service both call `post-publishing.service.server.ts` after claiming the post. Google Photos imports retain run-scoped leases and R2 rollback on failed metadata writes.
- `app/architecture.test.ts` enforces shared-directory limits, feature import direction, client/server component boundaries and SQL ownership. Update this map in the same change as moving files.

- UI has three levels: `app/components/` for domain-free primitives (BlurHash placeholder), feature `components/` for domain widgets, and `app/routes/<domain>/` for composed screens. Shared page shells belong to `app/layouts/`.

- Screen composition lives directly in registered route modules. No `_pages/` directory or forwarding page wrapper is needed. Route-only server imports are stripped by the production build; domain widgets cannot import server modules at runtime.
