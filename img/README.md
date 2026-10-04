# @gdgjp/img

Image hosting for GDG Japan, deployed at `img.gdgs.jp`. Authenticated chapter members upload
originals; `img.gdgs.jp/<id>` serves them publicly with automatic format/size optimization and
on-the-fly explicit transforms, no auth required on the GET path. Add `?f=original` when the exact
uploaded bytes are required. Every image is shared with the chapter it was uploaded to — any
member of that chapter can view, replace, move, or delete it — and can optionally sit in a flat
(non-hierarchical), chapter-owned folder.

## Tech stack

React Router v7 SSR on Cloudflare Workers, an OAuth relying party of `accounts/` via
`@gdgjp/gdg-lib`'s `initializeRpAuth` (no better-auth). D1 stores image metadata, R2 stores
original bytes, and Cloudflare Images handles transforms directly against the R2 stream — there
is no separate "upload to Cloudflare Images" step.

| Binding     | Type                    | Purpose                                                              |
| ----------- | ----------------------- | --------------------------------------------------------------------- |
| `DB`        | D1 (`gdgjp-img-db`)     | Image metadata (`images` table) and the RP's local `user` table.      |
| `ORIGINALS` | R2 (`gdgjp-img-originals`) | Original uploaded bytes. Key = the 8-char image id.                |
| `DERIVED`   | R2 (`gdgjp-img-derived`) | Canonical transformed renditions and passthrough markers.           |
| `IMAGES`    | Cloudflare Images       | Request-time transform: `env.IMAGES.input(r2Stream).transform(...).output(...)`. |
| `ASSETS`    | Workers Assets          | Static client build output.                                           |

`wrangler.toml` vars: `APP_URL`, `ACCOUNTS_URL`, `IDP_URL`, `IDP_CLIENT_ID`,
`IMG_AUTO_MAX_WIDTH` (`0` initially; set to `1600` after the rollout soak). Secrets:
`RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`.

## Directory structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the responsibility map and dependency rules.

- `app/features/auth/`: session and Bearer identity and chapter memberships.
- `app/features/images/`: image policies, use cases, storage, delivery, widgets and page data.
- `app/features/folders/`: chapter-owned folder policies, use cases, storage and widgets.
- `app/components/ui/`: domain-free primitives; `app/layouts/`: common composed shell and navigation.
- `app/routes/`: registered React Router modules combine HTTP adapters and composed screens; `app/routes.ts` preserves public URL registration.
- `app/lib/`: styling and HTTP cache primitives.
- `workers/`: request runtime and `ImageUploadService` RPC entrypoint.
- `migrations/`: D1 migrations; edit these, not `schema.sql`.
- `openapi/`: public image, dashboard and CLI API contracts.

## Image flow

- IDs are 8-char nanoids from `[0-9A-Za-z]`, generated with collision retry
  (`generateUniqueImageId`). Inbound `:id` params are validated with `isValidImageId` before any
  D1/R2 access.
- Upload (`routes/api/images/upload.ts`, `features/images/upload.server.ts`): write to R2 first, then insert the D1
  row. If the D1 insert fails, the R2 object is best-effort deleted via `ctx.waitUntil`. This
  ordering is load-bearing — an orphaned R2 object is recoverable, an orphaned D1 row pointing at
  nothing is not.
- Public GET (`routes/images/serve.tsx`): no auth. Honors `If-None-Match` before reading R2; the ETag encodes
  id, variant, source version, normalized parameters, and negotiated format. Plain URLs negotiate
  AVIF/WebP and use `IMG_AUTO_MAX_WIDTH` with `scale-down`; `?f=original` is the exact-byte escape
  hatch. Canonical width-ladder renditions persist in `DERIVED`, with Cache API in front. Images
  failures never turn an existing public URL into a 500; the original is served instead.
- Transform params (`features/images/img-url.ts`): `w`/`h` (1–4096), `dpr` (1–3), `fit` (`scale-down` |
  `contain` | `cover` | `crop` | `pad`), `radius` (1–2048 px), `q` (1–100), `f` (`auto` |
  `avif` | `webp` | `jpeg` | `png` | `original`), `variant=mobile`. `radius` makes the four
  corners transparent; a requested JPEG is returned as PNG so that transparency is preserved.
- Mutations (`routes/api/images/replace.ts`, `delete.ts`, `move.ts`, `share.ts`, …)
  are gated by `canAccessImage` (`features/images/policy.ts`) — the owner, a super admin per
  `gdg-lib`'s `isSuperAdmin`, or any member of the image's chapter. There is no separate
  editor/viewer split: any chapter member can also replace or delete. Replace reuses the existing
  `r2_key` so the public URL never changes; callers cache-bust with `?v=<updatedAt>`.
- Folders (`features/folders/`) are flat and chapter-owned; an image can only sit in a folder that
  belongs to its own chapter. Re-sharing an image to a different chapter (`routes/api/images/share.ts`)
  clears its folder as a side effect. Folder/slug-only updates deliberately don't bump
  `images.updated_at`, so they don't invalidate the public ETag.
- Max upload size is 10 MiB (`MAX_IMAGE_UPLOAD_BYTES` from `@gdgjp/gdg-lib`); content type must
  start with `image/`.
- Post-SSO-migration there is no `account` table — `user.id` is the stable internal UUID and new
  rows set `user_id === account_id`; older rows retain the historical Google `sub` in
  `account_id` for back-compat reads only.

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in:

| Variable             | Purpose                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| `RP_SESSION_SECRET`  | HMAC key for the RP's signed session + OIDC transaction cookies (`openssl rand -base64 48`). |
| `IDP_CLIENT_SECRET`  | Client secret issued by the `accounts` IdP for this RP.                 |
| `APP_URL`            | Overrides the prod value in `wrangler.toml`; `http://localhost:5175` locally. |
| `ACCOUNTS_URL`       | `http://localhost:5173` locally.                                        |
| `IDP_URL`            | `http://localhost:5173` locally.                                        |

No Cloudflare Images API token is needed for local dev — the `IMAGES` binding works against
`wrangler dev` directly. In production, set secrets with `wrangler secret put <NAME>`, never by
committing them.

If the `accounts` OAuth client id/secret/redirect URI for `img` changes, reseed it through
`accounts`' `/admin/seed-clients` before testing sign-in end to end.

```sh
pnpm --filter @gdgjp/img dev             # :5175
pnpm --filter @gdgjp/img build
pnpm --filter @gdgjp/img deploy
pnpm --filter @gdgjp/img typecheck       # wrangler types && react-router typegen && tsc --noEmit
pnpm --filter @gdgjp/img cf-typegen      # regenerate Worker types after a wrangler.toml change
pnpm --filter @gdgjp/img migrate:local   # applies migrations/ to local D1, re-dumps schema.sql
pnpm --filter @gdgjp/img migrate:remote  # applies migrations/ to remote D1, re-dumps schema.sql
pnpm --filter @gdgjp/img test            # vitest run
pnpm --filter @gdgjp/img test:e2e        # playwright; boots accounts on :5173 + img on :5175
```

`schema.sql` is generated from `migrations/` by `pnpm schema:dump` (run automatically after
`migrate:local`/`migrate:remote`) — edit migrations, not the dump.

Production setup for derived renditions is intentionally external to `wrangler.toml`:

```sh
wrangler r2 bucket create gdgjp-img-derived
wrangler r2 bucket lifecycle add gdgjp-img-derived --name expire-renditions --expire-days 30
```

The 30-day expiry bounds storage, but means a continuously hot rendition is transformed roughly
once per month after expiry. Also configure incomplete multipart-upload abortion for this bucket.

## Testing

Unit tests are Vitest, colocated as `*.test.ts` beside their feature modules.
`app/architecture.test.ts` checks dependency boundaries, cycles, UI ownership and public URLs. E2E tests are Playwright in `e2e/`, `baseURL http://localhost:5175`;
`playwright.config.ts` boots `accounts` on `:5173` as a dependency and reuses an existing dev
server outside CI. The current spec asserts the unauthenticated home page redirects to
`/signin?return_to=%2F` — keep that contract when touching the auth gate.

## Routes

Route registration order in `app/routes.ts` matters: the catch-all public viewer (`:id`) is
listed last so explicit routes (`signin`, `no-chapter`, `i/:id`, `api/*`, `auth/*`) match first.

## API contract

`openapi/openapi.yaml` (with `paths/` and `components/`) documents the public image GET, the
cookie-session dashboard endpoints, and the bearer-token `api/cli/v1/*` image and folder API.

```sh
pnpm --filter @gdgjp/img openapi:lint
pnpm --filter @gdgjp/img openapi:bundle
pnpm --filter @gdgjp/img openapi:generate  # bundle + generate openapi/types.generated.ts
```

The Go CLI client (`cli/internal/img/`) is generated from the bundled spec — after any `openapi/`
change, also run `(cd cli/internal/img && go generate ./...)` to refresh
`openapigen/openapi.gen.go`, and update `client.go`/`internal/command/img.go` for any new/changed
operation.
