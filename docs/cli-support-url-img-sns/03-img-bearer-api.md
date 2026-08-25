# Stage 03 — img CLI API and image feature boundary

## Context

`img/` (image hosting at img.gdgs.jp) is the cleanest of the three target apps: its business logic
already lives in `app/lib/{upload.ts,images.ts,r2.ts,permissions.ts,id.ts}`, and its existing
cookie-session routes (`api.upload.ts`, `api.replace.$id.ts`, `api.mobile.$id.ts`,
`api.delete.$id.ts`) are already thin — they parse the request, call `requireUserWithChapter`,
call one `lib/` function, and return JSON. `workers/app.ts` even already exports an
`ImageUploadService extends WorkerEntrypoint` RPC entrypoint (used today by `tinyurl/`'s upload
flow) — proof this logic is already reuse-ready across a trust boundary. This makes img the
lowest-risk app to add CLI auth to first. It also establishes the `app/features/<domain>/`
convention by moving image repository/storage/service/policy code into `app/features/images/`.
The route pattern is `api.cli.v1.*` → `getCliIdentity` → image use-case service (which applies the
image policy and coordinates repository/storage) before
the larger tinyurl and sns stages reuse it.

Depends on Stage 01: this stage imports `getCliIdentity` from `gdg-lib`. Do not write a local
CLI-identity fallback — Stage 01's function is required.

Read first: `img/CLAUDE.md` (the image-flow section: "Keep ordering (R2 first, DB second, rollback
R2 on DB error)" for `uploadImage`; "Max upload: 10 MiB"; "gated by `canMutateImage` (owner OR
`isSuperAdmin(user)`)"). Existing implementations to reuse as-is, unmodified:

- `img/app/lib/upload.ts`'s `uploadImage(env, ctx, input: ImageUploadInput): Promise<ImageUploadResult>`
  — `ImageUploadInput`/`ImageUploadResult`/`MAX_IMAGE_UPLOAD_BYTES` are exported from
  `@gdgjp/gdg-lib`. `ImageUploadResult = { id: string, url: string }`.
- `img/app/lib/images.ts`'s `getImage`, `updateImageBytes`, `setMobileImage`,
  `removeMobileImage`, `deleteImage` — all already `D1Database`-parameterized, no route coupling.
- `img/app/lib/permissions.ts`'s `canMutateImage(user: AuthUser, image: ImageRow): boolean` —
  `image.userId === user.id || isSuperAdmin(user)`.
- `img/app/lib/r2.ts`'s `putOriginal`/`deleteOriginal`.

## Design

### 1. Establish `app/features/images/`

Move `upload.ts`, `images.ts`, `r2.ts`, `permissions.ts`, and `id.ts` under
`app/features/images/`, naming repository/storage/service/policy roles explicitly where useful.
Update all existing dashboard and Worker imports in the same stage, including
`img/workers/app.ts`'s `ImageUploadService` import used by tinyurl's `IMG_UPLOAD` binding. Feature modules use domain
types only; generated OpenAPI types remain at route boundaries.

Change image mutation repositories to `UPDATE ... RETURNING` an `ImageRow`. Services own R2/D1
compensation: remove a newly written object when its D1 mutation fails, and preserve the existing
public object when replace/mobile persistence fails.

Expose actor-aware image use cases for list/get/upload/replace/set-mobile/delete. The actor is
`{ user: AuthUser; chapters: UserChapter[] }`; the service applies chapter and image policy before
mutating. Routes never call repositories/storage directly or reconstruct authorization rules.

### 2. New route files under `img/app/routes/api.cli.v1.*.ts`

A separate namespace from the existing cookie routes, whose HTTP behavior stays unchanged. Each new
route: extract the CLI-scoped token via `getCliIdentity(request, env.ACCOUNTS_URL)` (Stage 01) →
`401 { error: "invalid_token" }` if `null` → parse HTTP input → call the actor-aware feature
service → map its typed invalid/forbidden/not-found/conflict result to the documented JSON status.

- `GET /api/cli/v1/images` — bounded list of the caller's images (`limit`/`cursor`, optional
  `chapterId` filter).
- `GET /api/cli/v1/images/:id` — retrieve management metadata, gated by `canMutateImage`.
- `POST /api/cli/v1/images` — multipart upload. Parse `file` from form data (reject non-`file`
  values and non-`image/*` content types exactly like `api.upload.ts:16-24` does today). Resolve
  the chapter from multipart `chapterId`: optional only for exactly one membership, required for
  multiple memberships, and always validated against the identity. Zero memberships is `403`.
- `PUT /api/cli/v1/images/:id` — multipart replace, reusing the same `r2_key` (per `img/CLAUDE.md`:
  "Replace reuses the same `r2_key` so the public URL is stable").
- `POST /api/cli/v1/images/:id/mobile` — multipart mobile-variant upload via `setMobileImage`.
- `DELETE /api/cli/v1/images/:id` — no body.

### 3. Extend `img/openapi/`

Add `paths/cli-*.yaml` files (mirroring the existing `paths/{upload,replace,mobile,delete}.yaml`
shape) describing the six new endpoints under the `BearerAuth` security scheme (add that scheme
to `img/openapi/components/security-schemes.yaml` if only `cookieAuth` exists there today — check
before assuming). Reuse existing schemas from `img/openapi/components/schemas/` where the response
shape matches; add new ones only for fields the cookie routes don't expose (e.g. `url` in the
upload response, when the cookie route's `ImageId` schema only returns `id`).

### 4. Drive-by cleanup

`MAX_BYTES = 10 * 1024 * 1024` is hardcoded locally in `api.replace.$id.ts:9` and
`api.mobile.$id.ts:9` instead of importing `MAX_IMAGE_UPLOAD_BYTES` from `@gdgjp/gdg-lib` like
`api.upload.ts:1` and `lib/upload.ts:4` already do. Fix both to import the shared constant while
touching these files' neighbors — small enough to bundle into this stage rather than a separate
one.

### Out of scope

The public `$id.tsx` delivery route (transform/ETag/format-negotiation logic) needs no auth and is
not a CLI concern — do not touch it in this stage.

### API Contract

| Method | Path | Auth | Request body | Success response | Error responses |
|---|---|---|---|---|---|
| `GET` | `/api/cli/v1/images` | CLI Bearer | query: `chapterId?`, `limit?`, `cursor?` | `200 { images: ImageRow[], nextCursor: string \| null }` | `400`, `401`, `403` |
| `GET` | `/api/cli/v1/images/:id` | CLI Bearer | — | `200 { image: ImageRow }` | `401`, `403`, `404` |
| `POST` | `/api/cli/v1/images` | CLI Bearer | multipart: `file`, conditional `chapterId` | `201 { id: string, url: string }` | `400`, `413`, `401`, `403` |
| `PUT` | `/api/cli/v1/images/:id` | CLI Bearer | multipart: `file` | `200 { id: string, url: string, updatedAt: number }` | `400`, `413`, `401`, `403`, `404` |
| `POST` | `/api/cli/v1/images/:id/mobile` | CLI Bearer | multipart: `file` | `200 { id: string, updatedAt: number }` | same as replace |
| `DELETE` | `/api/cli/v1/images/:id` | CLI Bearer | none | `200 { id: string, deleted: true }` | `401`, `403`, `404` |

Response field shapes are drawn from `img/app/lib/images.ts`'s `ImageRow` (camelCase, matching the
`toImageRow` mapper) rather than inventing new field names. `updatedAt` comes from the updated
`ImageRow` returned by `UPDATE ... RETURNING`; the current functions return `void`, so routes must
not synthesize it.

The management list defaults to 50 rows and caps at 100 under the plan-wide API convention. The
existing gallery helper's default of 60 is presentation-specific and remains unchanged; this is a
documented API/UI pagination difference, not an accidental parity claim.

### 制約

- Do not modify `img/schema.sql` by hand — it's generated from `migrations/`; this stage needs no
  new migration since the `images` table already has every column these routes need.
- Do not add an `alt`/`altText` field anywhere in this stage — the `images` table has no such
  column (unlike sns's `post_media.alt_text`); don't invent one.
- Preserve the existing cookie-session routes' HTTP behavior. Their imports and service calls move
  to the new feature boundary, while the CLI route files are additive.

## Files to touch

- `img/app/features/images/` (move/rename the existing image modules and extend repository returns)
- `img/workers/app.ts` (update `ImageUploadService`'s moved upload import in the same commit)
- `img/app/routes/api.cli.v1.images.ts`, `img/app/routes/api.cli.v1.images.$id.ts`,
  `img/app/routes/api.cli.v1.images.$id.mobile.ts` (new)
- `img/app/routes.ts` (register the new routes)
- `img/app/routes/api.replace.$id.ts`, `img/app/routes/api.mobile.$id.ts` (drive-by `MAX_BYTES` fix)
- `img/openapi/paths/cli-*.yaml` (new), `img/openapi/openapi.yaml`,
  `img/openapi/components/security-schemes.yaml` (add `BearerAuth` if missing)

## Verification

1. Completion criteria: all six CLI endpoints work end-to-end against a real CLI-scoped token,
   return the exact shapes in the API Contract table, and the existing cookie-session routes and
   their e2e tests are unaffected.
2. Commands:
   ```
   pnpm --filter @gdgjp/img typecheck
   pnpm --filter @gdgjp/img test
   pnpm openapi:lint && pnpm openapi:generate && git diff --exit-code -- img/openapi
   ```
3. Regression to pin explicitly: the existing img e2e spec asserting home → `/signin?return_to=%2F`
   (per `img/CLAUDE.md`'s Tests section) must still pass unmodified — it's the one test that would
   catch an accidental change to the cookie-auth gate while adding the bearer gate alongside it.
4. Manual E2E: `pnpm --filter @gdgjp/img dev`, then with a valid bearer token:
   `curl -H "Authorization: Bearer $TOKEN" -F file=@test.jpg http://localhost:5175/api/cli/v1/images`
   and confirm `201 { id, url }`; fetch the returned `url` and confirm the image renders; then
   `curl -X DELETE -H "Authorization: Bearer $TOKEN" http://localhost:5175/api/cli/v1/images/$ID`
   and confirm a second GET on `url` 404s.
