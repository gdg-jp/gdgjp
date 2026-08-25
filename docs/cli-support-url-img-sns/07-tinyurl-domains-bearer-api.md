# Stage 07 — tinyurl domains CLI API (async)

## Context

Custom-domain provisioning (`app/lib/domain-provider.ts`'s `VercelDomainProvider`) calls Vercel's
API for DNS/domain verification — slow and external, unlike the plain D1/R2 CRUD in Stages 03 and
06. Per the user's resolved decision (`00-overview.md`), this is one of exactly two places in the
whole plan that use connpass's async Job+Queue pattern (`202` + poll) instead of a synchronous
response. tinyurl has no Cloudflare Queue binding today, so this stage adds one, modeled on
connpass's existing `jobs` table / `app/lib/jobs.server.ts` / `app/lib/job-runner.server.ts` /
queue-consumer shape rather than inventing a new one.

The dashboard's existing `domains.tsx` action remains synchronous. The Queue is introduced for the
CLI contract only, as explicitly selected in the resolved API response model; dashboard parity is
not the reason for this design.

Depends on Stage 01 (strict `getCliIdentity`), Stage 05 (`registerDomain`/`syncDomain`, now living in
`app/features/domains/` — call them, don't reimplement the
Vercel API calls here), and the independently landable Stage 07A job primitives. It has no
dependency on a connpass refactor.

Read first, as the structural template (do not copy connpass's connpass-specific fields, copy its
*shape*): `connpass/app/lib/jobs.server.ts` (`JobRecord`, `createJob`, `getJob`, `markJobRunning`/
`markJobSucceeded`/`markJobFailed`, `jobToJson`), `connpass/app/lib/job-runner.server.ts` (the
queue-message dispatcher), `connpass/workers/app.ts` (how the `queue()` handler wires into the
Worker's `ExportedHandler`), and connpass's `jobs` D1 table definition in its migrations (columns:
`id, type, status, group_slug, event_id, request_json, result_json, error, artifact_key,
created_by, created_at, updated_at, started_at, finished_at`).

## Design

### 1. New D1 migration: a `jobs` table for tinyurl

Same column shape as connpass's, minus the connpass-specific `group_slug`/`event_id` (tinyurl has
no equivalent grouping concept for this — a job here only ever concerns one `domain_id`): `id,
type, status, domain_id, request_json, result_json, error, created_by, created_at, updated_at,
started_at, finished_at`. `type` is a single fixed value for now (`'provision_domain'`) — an enum
of one, not a free-text column, so it's easy to extend later without a migration.

### 2. Domain job persistence under `app/features/domains/`

Implement `domain-job.repository.server.ts` and `domain-job.service.server.ts`, adapted to the
`domain_id`-shaped table. Consume Stage 07A's shared job status/transition/serialization primitives;
keep D1 queries, result types, leases, dispatch, and authorization app-owned. Do not migrate
connpass in this stage. `createJob` sends to a new
`env.JOB_QUEUE` binding (Cloudflare Queue) and, in dev, runs the job inline via `ctx.waitUntil`
exactly like connpass's does — preserve the `import.meta.env.DEV` inline-execution behavior,
it's there because "Vite local queue consumers often never fire."

If queue send fails after insertion, immediately mark the job failed and return a 503 response;
never leave an unsent job permanently queued. A retry creates a new job against the existing
error/pending domain instead of inserting a duplicate domain.

### 3. `domain-job-runner.server.ts`

A single-case dispatcher (`processJobMessage`) for the one job type this stage introduces:
`provision_domain` → atomic `queued → running` transition → call Stage 05's typed `syncDomain` →
mark succeeded only for `{ ok: true }`, otherwise mark failed with the persisted error-domain as
the result. Terminal redelivery is a no-op. A recently running job is retried later; a running job
whose `started_at` exceeds a documented lease can be atomically reclaimed, preventing worker
crashes from leaving it stuck forever while still avoiding concurrent provider calls.

### 4. Wire the queue consumer into `tinyurl/workers/app.ts`

Add a `queue(batch, env, ctx)` export calling `processJobMessage` per message, alongside the
existing `fetch` handler — mirroring connpass's `workers/app.ts:13-24`. Add the `JOB_QUEUE`
binding to `tinyurl/wrangler.toml` (producer + consumer, both pointing at the new
`gdgjp-tinyurl-jobs` queue) and
re-run `cf-typegen` so `Env` picks up the new binding.

### 5. New routes and resource policy

Under `/api/cli/v1`, add bounded domain list, single-domain get, registration, resynchronization,
soft deletion, and job polling. Registration calls Stage 05's `registerDomain`; the client submits
only `{ hostname, chapterId }`. The shared service normalizes/detects mode and upstream, applies
feature/safety/capacity checks, and creates the pending row. `POST .../:id/sync` creates a retry job
for an existing authorized non-active domain. Delete reuses the dashboard's active-link guard and
provider removal behavior.

Job reads load the related domain and allow the creator, an organizer of its owning chapter, or a
super-admin. Other authenticated callers receive `404` to avoid resource enumeration.

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `GET` | `/api/cli/v1/domains` | CLI Bearer | query: `chapterId?`, `limit?`, `cursor?` | `200 { domains: Domain[], nextCursor }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/domains/:id` | CLI Bearer | — | `200 { domain: Domain }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/domains` | CLI Bearer | `{ hostname: string, chapterId: number }` | `202 { job: Job }` | `400`, `401`, `403`, `503` |
| `POST` | `/api/cli/v1/domains/:id/sync` | CLI Bearer | none | `202 { job: Job }` | `401`, `403`, `404`, `409`, `503` |
| `DELETE` | `/api/cli/v1/domains/:id` | CLI Bearer | none | `200 { id, deleted: true }` | `401`, `403`, `404`, `409` (active links) |
| `GET` | `/api/cli/v1/jobs/:jobId` | CLI Bearer | — | `200 Job` | `401`, `404` |

`Job` shape (field-for-field matching connpass's `jobToJson`, adapted to this stage's table):
```ts
type Job = {
  id: string;
  type: "provision_domain";
  status: "queued" | "running" | "succeeded" | "failed";
  domainId: number;
  request: Record<string, unknown>; // the original POST body, redacted of nothing sensitive here
  result: Domain | null;   // persisted success or error-state domain after processing
  error: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
```

### 制約

- Reuse connpass's job-table/`Job`-envelope *shape* exactly (field names, status enum values) even
  though the underlying domain differs — this is a deliberate consistency choice so the CLI's
  future job-polling code (Stage 09) and any operator familiar with `gdg connpass jobs` recognizes
  the same pattern immediately. Do not invent a different status vocabulary (e.g. `"pending"`
  instead of `"queued"`).
- Every new Worker binding change (the `JOB_QUEUE` binding added to `wrangler.toml`) requires
  `pnpm --filter @gdgjp/tinyurl cf-typegen` to be re-run so `Env`'s generated type stays in sync —
  do this before typechecking, not after.
- Do not make `POST /api/cli/v1/domains` synchronous "for simplicity" — the whole point of this
  stage is the async pattern; a synchronous fallback defeats Stage 09's job-polling CLI commands.

## Files to touch

- `tinyurl/migrations/00NN_jobs.sql` (new)
- `tinyurl/app/features/domains/{domain-job.repository.server.ts,domain-job.service.server.ts,domain-job-runner.server.ts}`
- `tinyurl/app/routes/api.cli.v1.{domains,domains.$id,domains.$id.sync,jobs.$jobId}.ts` (new)
- `tinyurl/workers/app.ts` (add `queue()` export)
- `tinyurl/wrangler.toml` (`JOB_QUEUE` binding)
- `tinyurl/openapi/paths/cli-domains.yaml`, `paths/cli-jobs.yaml` (new)

## Verification

1. Completion criteria: `POST /api/cli/v1/domains` returns a `202` with a `Job` in `queued` status
   that transitions to `succeeded`/`failed` after the queue consumer runs, observable via polling
   `GET /api/cli/v1/jobs/:jobId`; list/get/sync/delete complete the operator workflow.
2. Commands:
   ```
   pnpm --filter @gdgjp/tinyurl migrate:local
   pnpm --filter @gdgjp/tinyurl cf-typegen
   pnpm --filter @gdgjp/tinyurl typecheck && pnpm --filter @gdgjp/tinyurl test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- tinyurl/openapi
   ```
3. Regression to pin explicitly: a domain provisioning failure (e.g. Vercel API returns an error)
   must land the job in `status: "failed"` with a non-null `error`, not leave it stuck in
   `"running"` forever — write tests for `{ ok: false }`, queue-send failure, terminal redelivery,
   and stale-running lease recovery.
4. Manual E2E: `pnpm --filter @gdgjp/tinyurl migrate:local && pnpm --filter @gdgjp/tinyurl dev`,
   then `POST /api/cli/v1/domains` with a valid bearer token and a test hostname, note the
   returned `job.id`, poll `GET /api/cli/v1/jobs/:jobId` every couple seconds and confirm it
   reaches a terminal status; in local dev, since the queue consumer may not fire, confirm the
   `import.meta.env.DEV` inline-execution fallback (Design step 2) actually runs it — if it
   doesn't, that fallback is broken and blocks all local testing of this flow.
