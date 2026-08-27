# Stage 13 — sns X-publish CLI API

## Context

"Publish now to X" calls the X API directly (`sns/app/lib/x.server.ts`'s token/posting flow). It
is a bounded external HTTP call, so the CLI endpoint responds **synchronously** — no Cloudflare
Queue, no `jobs` table. (The async Job+Queue pattern is connpass-only, where it exists because
connpass drives connpass.com through Playwright.)

The dashboard's current "今すぐ投稿" sets `scheduledAt` to now and relies on the minute cron
(`sns/app/lib/publish.server.ts`'s `publishDuePosts`). This stage adds a CLI endpoint that
performs the publish attempt inline and returns the resulting terminal post, converging with the
cron path on the same atomic post claim and X-posting step.

Depends on Stage 12 (posts resource) and Stage 11 (X-account provider/token refresh). No
dependency on any shared job primitives, on TinyURL, or on connpass. The publish endpoint hangs
off an existing post id and reuses the X-account feature rather than re-deriving OAuth handling.

Read first: `sns/app/lib/publish.server.ts`'s `claimAndPublish` / `publishDuePosts` — the
*existing* X-posting logic the cron path uses. This stage calls the same underlying X-API step,
not a reimplementation of "post to X".

## Design

### 1. Extract the shared X-posting step

Pull the external X posting step out of `publish.server.ts` into a single operation
(`post-publishing.service.server.ts`) shared by cron and CLI, so there is exactly one place that
calls the X API.

### 2. `publishNow` service inside `app/features/posts/`

Add a `publishNow(postId, actor)` service with different eligibility semantics from
`claimAndPublish`: it atomically claims a specific post regardless of a future `scheduledAt`.
`scheduled`, `waiting_for_photo`, `failed`, and `needs_confirmation` are eligible (subject to
required media). Retrying `needs_confirmation` is an explicit operator action after checking X for
an uncertain prior post. `published` or `posting` returns `409`.

The service performs the atomic claim, calls the shared X-posting step, persists the outcome, and
returns a typed result containing the updated `Post`. External failure or uncertainty is returned
after persisting `failed` / `needs_confirmation` — never swallowed as `void`. The existing cron
continues to use the due-time gate and the same atomic claim, so cron and CLI cannot both post
the same post.

### 3. New route

`POST /api/cli/v1/posts/:id/publish` — authorizes the caller against the post's chapter (SNS
organizer/contributor or super-admin), calls `publishNow`, and returns the terminal `Post`
synchronously. Do not touch `sns/workers/app.ts`'s existing `scheduled()` handler; this endpoint
is additive.

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/cli/v1/posts/:id/publish` | CLI Bearer | none | `200 { post: Post }` | `401`, `403`, `404`, `409` (published/posting/missing required media), `502` (X API failed — body still carries the persisted `failed`/`needs_confirmation` post) |

`Post` is Stage 10's type. On a terminal-failure outcome the endpoint still returns the persisted
post (with `status: "failed"` or `"needs_confirmation"`) so a script can read the reason.

### 制約

- No `jobs` table, no `JOB_QUEUE` binding, no queue consumer, no `202`/poll flow, no
  `GET /api/cli/v1/jobs/:jobId`.
- Do not duplicate `publish.server.ts`'s X-API-call logic — call the extracted shared step.
- Do not touch the existing `scheduled()` handler or the cron-driven `publishDuePosts` path.

## Files to touch

- `sns/app/features/posts/{post-publishing.service.server.ts,publish-now.service.server.ts}` (new)
- `sns/app/routes/api.cli.v1.posts.$id.publish.ts` (new)
- `sns/openapi/paths/cli-publish.yaml` (new)

## Verification

1. Completion criteria: `POST /api/cli/v1/posts/:id/publish` returns `200 { post }` with the post
   `published` on success, and the existing cron-driven scheduled-publish flow is unaffected.
2. Commands:
   ```
   pnpm --filter @gdgjp/sns typecheck && pnpm --filter @gdgjp/sns test
   pnpm --filter @gdgjp/sns openapi:lint && pnpm --filter @gdgjp/sns openapi:generate
   git diff --exit-code -- sns/openapi
   ```
3. Regression to pin explicitly: a second `POST .../publish` for a post already `published` (or
   `posting`) returns `409`, never a second X post. Pin retries from both `failed` and
   `needs_confirmation`; the latter requires a fresh explicit publish request and is never
   reclaimed automatically by cron.
4. Manual E2E: `pnpm --filter @gdgjp/sns dev`, create a draft via Stage 12's
   `POST /api/cli/v1/posts`, call `POST .../publish`, and confirm the response post is `published`
   with a non-null `publishedXPostId` — then confirm the cron path (`publishDuePosts`) still runs
   cleanly for a *different*, separately scheduled post.
