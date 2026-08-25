# Stage 12 — sns CLI API (posts/media/X accounts/contributors)

## Context

sns is the only one of the three target apps with no `openapi/` directory at all — this stage
bootstraps one from scratch, mirroring `img/openapi/`'s structure (`openapi.yaml`, `redocly.yaml`,
`components/{schemas,responses,parameters,securitySchemes}`, `paths/*.yaml`), since img is the
cleanest existing example in this repo. It then adds synchronous CLI-scoped routes for post/media CRUD
and contributor management, built on Stage 10's `app/features/posts/` aggregate and Stage 11's
`app/features/{contributors,x-accounts}/` services.

Depends on Stage 01 (strict `getCliIdentity`), Stage 10's post aggregate operations, and Stage 11's
contributor/X-account feature services.

Explicitly excludes: Google Photos routes (deferred per `00-overview.md`'s resolved scope) and
"publish now to X" (Stage 13 — it needs the async Job+Queue pattern this stage's endpoints don't).

Read first: `img/openapi/`'s directory tree (Stage 03 already extended it — use it, not
connpass's, as the structural template, since img is closer to sns in shape: no async jobs in its
base contract). `sns/app/lib/access.server.ts`'s `requireSnsAccess` — the CLI routes need an
equivalent chapter/contributor-role check built from `getCliIdentity`'s
`{ user, chapters }` instead of a session cookie; write a small CLI-specific access helper (see
Design) rather than trying to reuse `requireSnsAccess` itself, since it's built around
`redirect()`-throwing (a React Router loader/action convention) which doesn't fit a JSON API's
`401`/`403` response convention.

## Design

### 1. Bootstrap `sns/openapi/`

```
sns/openapi/
  openapi.yaml
  redocly.yaml
  components/
    schemas/index.yaml
    responses/common.yaml   # 400/401/403/404 shared error response, { error: string }
    parameters/common.yaml
    securitySchemes/auth.yaml   # BearerAuth: { type: http, scheme: bearer }
  paths/
    cli-posts.yaml
    cli-media.yaml
    cli-contributors.yaml
    cli-x-accounts.yaml
```

Add the corresponding `openapi:bundle`/`openapi:generate`/`openapi:lint` scripts to
`sns/package.json` (copy img's or tinyurl's script definitions verbatim, adjusting the package
name), matching the pattern every other OpenAPI-bearing app in this repo already follows.

### 2. `app/features/auth/cli-access.server.ts`

```ts
export async function requireCliSnsAccess(
  request: Request,
  env: Env,
  chapterId: number,
): Promise<{ user: AuthUser; role: "organizer" | "member" | "contributor" } | { error: 401 | 403 }>
```

Calls `getCliIdentity` (Stage 01), then checks the caller's role for `chapterId` the same way
`requireSnsAccess` does today (`chapter.role === "organizer" || isContributor(db, chapterId,
user.email)`), but returns a discriminated result instead of throwing/redirecting, so CLI
routes can turn it into a JSON `401`/`403` instead of a redirect response. Add a separate
`requireCliSnsOrganizer` for contributor administration.

For routes addressed by post/media/X-account id, load the resource first and derive its chapter
before authorization. Never authorize an id-addressed mutation using a caller-supplied chapter id.
Use `404` for inaccessible id-addressed resources to avoid cross-chapter enumeration.

### 3. New route files under `sns/app/routes/api.cli.v1.*.ts`

- `POST|GET /api/cli/v1/posts` — create via `createDraft` / bounded list through the post repository.
- `GET|PATCH|DELETE /api/cli/v1/posts/:id` — read the complete aggregate (`post` plus ordered
  `media`) via `getDraft` / update via `updateDraft` / delete via
  `deleteDraft`, which returns `{ ok: false, error }` when the post is
  `published`/`posting` — translate that into `409`, not `400`, since it's a state conflict, not a
  malformed request).
- `POST /api/cli/v1/posts/:id/media` — via `attachMedia`.
- `DELETE /api/cli/v1/media/:id` — via `removeMedia`.
- `POST|GET|DELETE /api/cli/v1/contributors` — organizer-only contributor administration via
  `addContributor`/existing list logic.
- `GET /api/cli/v1/x-accounts` — list usable account summaries for an authorized chapter so
  `xAccountId` is discoverable. Never return encrypted token columns.
- `DELETE /api/cli/v1/x-accounts/:id` — organizer/contributor access to the chapter, matching live
  settings behavior, with required `xUserId` confirmation in JSON to prevent accidental revoke.

### 4. Wire `sns` into the root OpenAPI pipeline and CI

Add `&& pnpm --filter @gdgjp/sns openapi:bundle` (etc.) to the root `package.json`'s
`openapi:bundle`/`openapi:generate`/`openapi:lint` scripts, which today only list `accounts`,
`img`, `tinyurl`, `wiki`, `connpass`. Confirm `.github/scripts/changed-workspaces.mjs`'s `openapi`
output's path filter is either already broad enough to catch `sns/openapi/**` (e.g. a generic
`**/openapi/**` glob) or add `sns/openapi/**` explicitly if the filter lists apps by name.

### API Contract

| Method | Path | Auth | Request body | Success | Errors |
|---|---|---|---|---|---|
| `POST` | `/api/cli/v1/posts` | CLI Bearer | `{ chapterId, xAccountId, text, scheduledAt, condition, tagHandles? }` | `201 { post }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/posts` | CLI Bearer | query: `chapterId`, `status?`, `limit?`, `cursor?` | `200 { posts, nextCursor }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/posts/:id` | CLI Bearer | — | `200 { post, media: PostMedia[] }` | `401`, `404` |
| `PATCH` | `/api/cli/v1/posts/:id` | CLI Bearer | `{ xAccountId?, text?, scheduledAt?, condition?, tagHandles? }` | `200 { post }` | `400`, `401`, `404`, `409` |
| `DELETE` | `/api/cli/v1/posts/:id` | CLI Bearer | — | `200 { id, deleted: true }` | `401`, `404`, `409` |
| `POST` | `/api/cli/v1/posts/:id/media` | CLI Bearer | multipart: `file`, `sortOrder`, `altText?` | `201 { media, post }` | `400`, `401`, `404`, `409`, `413` |
| `DELETE` | `/api/cli/v1/media/:id` | CLI Bearer | — | `200 { id, deleted: true, post }` | `401`, `404`, `409` |
| `POST` | `/api/cli/v1/contributors` | organizer CLI Bearer | `{ chapterId, userEmail }` | `201 { chapterId, userEmail }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/contributors` | organizer CLI Bearer | query: `chapterId`, `limit?`, `cursor?` | `200 { contributors, nextCursor }` | `400`, `401`, `403` |
| `DELETE` | `/api/cli/v1/contributors` | organizer CLI Bearer | query: `chapterId`, `userEmail` | `200 { deleted: true }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/x-accounts` | CLI Bearer | query: `chapterId` | `200 { accounts: XAccountSummary[] }` | `400`, `401`, `403` |
| `DELETE` | `/api/cli/v1/x-accounts/:id` | CLI Bearer | `{ xUserId: string }` | `200 { id, revoked: true }` | `400`, `401`, `404` |

`POST`/`PATCH` intentionally do not accept `linkPreview`. Stage 10 derives and persists preview
metadata server-side from the final `text`, matching dashboard save behavior and preventing clients
from injecting stale or unrelated cards. Preview-provider failure is non-fatal and stores nulls.

The post detail response is the discovery surface for existing `mediaId` values; media is ordered
by `sortOrder`. A client must be able to inspect and remove media attached by the dashboard or an
earlier CLI session, not only media it uploaded in the current process.

Note contributor deletion is modeled as `DELETE /api/cli/v1/contributors` with query params, not
an invented composite path id, since the underlying table has no single-column id (its
primary key is the `(chapter_id, user_email)` pair) — this deliberately differs from every other
resource's `/:id` convention in this plan, and that difference must be called out explicitly in
this stage's actual OpenAPI spec so it isn't mistaken for an oversight.

### 制約

- Do not add Google Photos routes here — deferred per `00-overview.md`. If a delegate session
  finds `google.photos.library.tsx`'s logic tempting to reuse for a `POST /api/cli/v1/posts/:id/media`
  variant, don't — that's explicitly out of scope.
- Do not add a "publish now" endpoint here — that's Stage 13, which needs the async Job pattern.
- Follow img's `openapi/` directory shape (Design step 1), not connpass's — connpass's includes
  job/async schemas this stage's base contract doesn't need yet (Stage 13 adds those).

## Files to touch

- `sns/openapi/` (new tree: `openapi.yaml`, `redocly.yaml`, `components/`, `paths/`)
- `sns/package.json` (add `openapi:*` scripts)
- `sns/app/features/auth/cli-access.server.ts` (new)
- `sns/app/routes/api.cli.v1.{posts,posts.$id,posts.$id.media,media.$id,contributors,x-accounts,x-accounts.$id}.ts`
- `sns/app/routes.ts` (register)
- root `package.json` (add `sns` to `openapi:*` scripts)
- `.github/scripts/changed-workspaces.mjs` (confirm/add `sns/openapi/**` to the `openapi` filter)

## Verification

1. Completion criteria: every endpoint in the API Contract table works end-to-end, `sns/openapi/`
   passes `openapi:lint`, and `pnpm openapi:check` (which now includes sns) passes clean.
2. Commands:
   ```
   pnpm --filter @gdgjp/sns typecheck && pnpm --filter @gdgjp/sns test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- sns/openapi
   pnpm openapi:check
   ```
3. Regression to pin explicitly: `DELETE /api/cli/v1/posts/:id` on a `published` post must return
   `409`, not silently succeed or 500 — write a test creating a post in `published` status and
   asserting the delete endpoint rejects it with the exact status code and error shape.
4. Manual E2E: `pnpm --filter @gdgjp/sns dev`, then with a valid bearer token for an organizer:
   create a post, attach an image via `POST .../media`, list posts and confirm it appears, delete
   it, and confirm a second `GET` on it 404s; separately, add and then remove a contributor via
   the CLI endpoints and confirm the change is reflected in the settings UI.
