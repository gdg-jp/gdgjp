# Stage 13 — sns X-publish CLI API (async)

## Context

"Publish now to X" calls the X API directly (`sns/app/lib/x.server.ts`'s token/posting flow) —
slow and external, like tinyurl's Vercel domain provisioning in Stage 07. Per the user's resolved
decision (`00-overview.md`), this is the second and last place in the whole plan using connpass's
async Job+Queue pattern. sns has no Cloudflare Queue binding today (it currently only has a cron
trigger driving `publishDuePosts` — see `sns/app/lib/publish.server.ts`), so this stage adds one,
reusing the exact same `Job` envelope shape Stage 07A defines and Stage 07 consumes, rather than
diverging into a second job-shape convention.

This is intentionally a CLI-specific orchestration difference. The dashboard's current “今すぐ投稿”
continues to set `scheduledAt` to now and rely on the minute cron; the new CLI endpoint queues an
immediate attempt so `--wait` has a precise operation to observe. Both adapters converge on the
same atomic post claim/X-posting service and persisted post/post-attempt state.

Depends on Stage 12 (posts resource), Stage 11 (X-account provider/token refresh), and the
independent Stage 07A shared job primitives. It does not depend on TinyURL's Stage 07 provisioning
implementation or on connpass. The publish endpoint hangs off an existing post id; it reuses the
X-account feature rather than re-deriving OAuth token handling.

Read first: Stage 07A's app-neutral envelope contract and Stage 07's
`07-tinyurl-domains-bearer-api.md` as one app-owned table/queue-consumer example, plus
`sns/app/lib/publish.server.ts`'s `claimAndPublish`/`publishDuePosts` (the *existing* X-posting
logic the cron path already uses — this stage's queue consumer should call the same underlying
X-API-call logic those functions use, not a third reimplementation of "post to X").

## Design

### 1. New D1 migration: a `jobs` table for sns

Same shape as Stage 07's tinyurl `jobs` table, with `post_id` in place of `domain_id`: `id, type,
status, post_id, request_json, result_json, error, created_by, created_at, updated_at, started_at,
finished_at`. `type` is `'publish_post'`.

### 2. Publish job persistence inside `app/features/posts/`

Use Stage 07A's shared `gdg-lib/src/jobs` mechanics with app-owned
`publish-job.repository.server.ts`/`publish-job.service.server.ts`, adapted to `post_id`. Reuse the same dev-mode
inline-execution-via-`ctx.waitUntil` pattern documented in Stage 07, implemented locally rather than
imported from TinyURL (needed because Vite local queue consumers often never fire).

Add a partial unique index (or equivalent atomic conditional insert) preventing more than one
`queued`/`running` publish job per post. Queue-send failure marks the inserted job failed and
returns `503`; it cannot remain queued forever.

### 3. `publish-job-runner.server.ts` and `publishNow`

Extract the external X posting step into a single operation shared by cron and CLI, then add a
`publishNow` service with different eligibility semantics from `claimAndPublish`: it atomically
claims a specific post regardless of future `scheduledAt`; `scheduled`, `waiting_for_photo`,
`failed`, and `needs_confirmation` are eligible (subject to required media). Retrying
`needs_confirmation` is an explicit operator action after checking X for an uncertain prior post.
`published`, `posting`, or a post with an active queued/running job returns `409`. The operation
returns a typed outcome containing the updated post. External failure/uncertainty is
returned after persisting `failed`/`needs_confirmation`; it is not swallowed as `void`.

The runner performs an atomic job `queued → running` transition, calls `publishNow`, marks
`succeeded` only when the post is actually `published`, and otherwise marks failed with the
persisted post plus error. Queue redelivery is idempotent. The existing cron continues to use the
due-time gate and the same atomic post claim, so cron and CLI cannot both post it.

### 4. Wire the queue consumer into `sns/workers/app.ts`

`sns/workers/app.ts` already has a `scheduled()` cron handler (per `sns/wrangler.toml`'s
`* * * * *` trigger) — add a `queue(batch, env, ctx)` export alongside it, additive, not replacing
anything. Add the `JOB_QUEUE` binding to `sns/wrangler.toml` (e.g. `gdgjp-sns-jobs`) and re-run
`cf-typegen`.

### 5. New routes

`POST /api/cli/v1/posts/:id/publish` (atomically reserves/kicks off the job) and
`GET /api/cli/v1/jobs/:jobId` (poll)
— the same job-polling route shape as Stage 07. Shared lifecycle primitives come from `gdg-lib`;
SNS persistence, post policy, and dispatch remain feature-owned.

Job reads load the related post and authorize against its chapter. Allow the job creator, any
currently authorized SNS organizer/contributor for that chapter, or super-admin; return `404` to
other authenticated callers. A job id is never sufficient authorization.

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/cli/v1/posts/:id/publish` | CLI Bearer | none | `202 { job: Job }` | `401`, `404`, `409` (published/posting/missing required media/active job), `503` |
| `GET` | `/api/cli/v1/jobs/:jobId` | CLI Bearer | — | `200 Job` | `401`, `404` |

`Job` shape — identical field names/status enum to Stage 07's, `type` fixed to `"publish_post"`,
`postId` in place of `domainId`, `result` is the updated `Post` (Stage 10's type) once succeeded:

```ts
type Job = {
  id: string; type: "publish_post";
  status: "queued" | "running" | "succeeded" | "failed";
  postId: string;
  request: Record<string, unknown>;
  result: Post | null;
  error: string | null;
  createdBy: string; createdAt: string; updatedAt: string;
  startedAt: string | null; finishedAt: string | null;
};
```

### 制約

- Reuse the same `Job` field names and status vocabulary as Stage 07's tinyurl version (`"queued"
  | "running" | "succeeded" | "failed"`, not e.g. `"pending"`) — consistency across the two apps
  that use this pattern matters more than either app's Job table being a perfect fit for its own
  domain. Two per-app tables with the same shape is fine; two different *shapes* is not.
- Do not duplicate `publish.server.ts`'s X-API-call logic a second time — call into it (or extract
  its inner step, per Design step 3) rather than writing a fresh `fetch` to the X API here.
- Every new Worker binding change (`JOB_QUEUE`) requires `pnpm --filter @gdgjp/sns cf-typegen`
  before typechecking.
- Do not touch `sns/workers/app.ts`'s existing `scheduled()` handler or its cron-driven
  `publishDuePosts` path — this stage's on-demand "publish now" is additive, the existing
  scheduled-publish flow must keep working exactly as before.

## Files to touch

- `sns/migrations/00NN_jobs.sql` (new)
- `sns/app/features/posts/{publish-job.repository.server.ts,publish-job.service.server.ts,publish-job-runner.server.ts,post-publishing.service.server.ts}`
- `sns/app/routes/api.cli.v1.{posts.$id.publish,jobs.$jobId}.ts` (new)
- `sns/workers/app.ts` (add `queue()` export)
- `sns/wrangler.toml` (`JOB_QUEUE` binding)
- `sns/openapi/paths/{cli-publish.yaml,cli-jobs.yaml}` (new)

## Verification

1. Completion criteria: `POST /api/cli/v1/posts/:id/publish` returns a `202` with a Job that
   transitions to `succeeded`/`failed`, and the existing cron-driven scheduled-publish flow is
   unaffected.
2. Commands:
   ```
   pnpm --filter @gdgjp/sns migrate:local
   pnpm --filter @gdgjp/sns cf-typegen
   pnpm --filter @gdgjp/sns typecheck && pnpm --filter @gdgjp/sns test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- sns/openapi
   ```
3. Regression to pin explicitly: publishing the same post twice (a second `POST .../publish` call
   while the first job is still `running`, or after it already `succeeded`) must not double-post
   to X — write a test asserting the second call returns `409`, not a second successful job. Also
   pin retries from both `failed` and `needs_confirmation`; the latter requires a fresh explicit
   publish request and is never reclaimed automatically by cron.
4. Manual E2E: `pnpm --filter @gdgjp/sns migrate:local && pnpm --filter @gdgjp/sns dev`, create a
   draft post via Stage 12's `POST /api/cli/v1/posts`, call `POST .../publish`, poll `GET
   /api/cli/v1/jobs/:jobId` until terminal, and confirm the post's status becomes `published` with
   a non-null `publishedXPostId` — then confirm the existing cron path (`publishDuePosts`) still
   runs cleanly for a *different*, separately scheduled post.
