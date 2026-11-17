# Stage 07 — tinyurl domains CLI API

## Context

Custom-domain provisioning (`app/lib/domain-provider.ts`'s `VercelDomainProvider`) calls Vercel's
API for DNS/domain verification. It is a plain external HTTP call — bounded, not a long-running
scrape — so the CLI endpoints respond **synchronously**, exactly like the dashboard's existing
`domains.tsx` action already does. There is no Cloudflare Queue and no `jobs` table in tinyurl;
the async Job+Queue pattern is connpass-only (it exists there because connpass drives
connpass.com through Playwright/Browser Rendering).

Depends on Stage 01 (strict `getCliIdentity`) and Stage 05 (`registerDomain` / `syncDomain`,
living in `app/features/domains/` — call them, don't reimplement the Vercel API calls here). No
dependency on any shared job primitives or a connpass refactor.

## Design

### 1. New routes and resource policy

Under `/api/cli/v1`, add bounded domain list, single-domain get, registration, resynchronization,
and soft deletion.

- `POST /api/cli/v1/domains` calls Stage 05's `registerDomain`; the client submits only
  `{ hostname, chapterId }`. The shared service normalizes/detects mode and upstream, applies
  feature/safety/capacity checks, creates the pending row, and attempts provider provisioning
  inline. It returns the persisted `Domain` (whose `status`/`providerError` reflect the
  provisioning outcome — a provider failure still yields a `201` with an error-state domain,
  matching the dashboard).
- `POST /api/cli/v1/domains/:id/sync` loads the domain (404 if missing), authorizes the caller
  against its owning chapter via `manageableChapterIds` (403), rejects an already-`active` domain
  (409), then calls Stage 05's `syncDomain` and returns the persisted `Domain`.
- `DELETE /api/cli/v1/domains/:id` reuses the dashboard's active-link guard and provider-removal
  behavior.

Reuse the shared CLI HTTP boundary helpers (`app/lib/cli-http.server.ts`) and the
`FeatureFailure` → HTTP mapper (`app/lib/cli-errors.server.ts`'s `featureFailureResponse`).

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/cli/v1/domains` | CLI Bearer | query: `chapterId?`, `limit?`, `cursor?` | `200 { domains: Domain[], nextCursor }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/domains/:id` | CLI Bearer | — | `200 { domain: Domain }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/domains` | CLI Bearer | `{ hostname: string, chapterId: number }` | `201 { domain: Domain }` | `400`, `401`, `403`, `409` |
| `POST` | `/api/cli/v1/domains/:id/sync` | CLI Bearer | none | `200 { domain: Domain }` | `401`, `403`, `404`, `409` |
| `DELETE` | `/api/cli/v1/domains/:id` | CLI Bearer | none | `200 { id, deleted: true }` | `401`, `403`, `404`, `409` (active links) |

`Domain` is the shape already returned by Stage 05 / the dashboard loader (see
`openapi/components/schemas/cli-domains.yaml#/Domain`).

### 制約

- Do not add a `jobs` table, a `JOB_QUEUE` binding, a queue consumer, or a `202`/poll flow.
  Domain provisioning is a synchronous request in both the dashboard and the CLI.
- `registerDomain` / `syncDomain` are the only place the Vercel provider is called — routes just
  parse/format HTTP.

## Files to touch

- `tinyurl/app/routes/api.cli.v1.{domains,domains.$id,domains.$id.sync}.ts` (new)
- `tinyurl/app/lib/{cli-auth,cli-errors,cli-http}.server.ts` (shared CLI boundary; also used by
  Stages 06 and 08)
- `tinyurl/openapi/paths/cli-domains.yaml`, `paths/cli-domain.yaml`, `paths/cli-domain-sync.yaml`
  (new); `openapi/components/schemas/cli-domains.yaml`

## Verification

1. Completion criteria: `POST /api/cli/v1/domains` returns `201 { domain }` synchronously with the
   provisioning outcome reflected in `domain.status`; `sync` returns `200 { domain }`;
   list/get/delete complete the operator workflow.
2. Commands:
   ```
   pnpm --filter @gdgjp/tinyurl typecheck && pnpm --filter @gdgjp/tinyurl test
   pnpm --filter @gdgjp/tinyurl openapi:lint && pnpm --filter @gdgjp/tinyurl openapi:generate
   git diff --exit-code -- tinyurl/openapi
   ```
3. Regression to pin: a provider failure during registration must still return `201` with the
   persisted error-state domain (`status: "error"`, non-null `providerError`), never a 5xx that
   loses the created row.
4. Manual E2E: `pnpm --filter @gdgjp/tinyurl dev`, then `POST /api/cli/v1/domains` with a valid
   CLI bearer token and a test hostname; confirm the response body is the domain and a follow-up
   `GET /api/cli/v1/domains/:id` shows the same persisted state.
