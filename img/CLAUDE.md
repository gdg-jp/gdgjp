# CLAUDE.md — `@gdgjp/img`

img.gdgs.jp. Repo-wide conventions in `../CLAUDE.md`.

Image hosting. Authenticated chapter members upload; `img.gdgs.jp/<id>` is publicly viewable (no auth on the public `:id` GET). Originals in R2; on-the-fly resize/format via Cloudflare Images `IMAGES` binding (`env.IMAGES.input(...).transform(...).output(...)`).

Every image is shared with exactly one chapter (`images.chapter_id`) — any member of that chapter can view, replace, move, or delete it, not just the uploader. Images can optionally sit in a flat (non-hierarchical), chapter-owned folder (`folders`, `images.folder_id`); a folder and the images in it always belong to the same chapter.

## Dev

```
pnpm --filter @gdgjp/img dev            # :5175
pnpm --filter @gdgjp/img test:e2e       # boots accounts :5173 + img :5175
pnpm --filter @gdgjp/img migrate:local  # also re-dumps schema.sql
pnpm --filter @gdgjp/img cf-typegen     # after wrangler.toml changes
```

E2E needs `accounts` on :5173 — `playwright.config.ts` boots it via `pnpm --dir ../accounts dev`. `webServer` reuses existing dev outside CI.

## Bindings

- `DB` — D1 `gdgjp-img-db`. Migrations in `migrations/`, dumped to `schema.sql` (don't edit dump).
- `ORIGINALS` — R2 bucket. R2 keys equal the 8-char image id (`lib/id.ts`).
- `DERIVED` — disposable canonical renditions; production lifecycle expires objects after 30 days.
- `IMAGES` — Cloudflare Images binding for transforms (no separate upload step).

Vars: `APP_URL`, `ACCOUNTS_URL`, `IDP_URL`, `IDP_CLIENT_ID`, `IMG_AUTO_MAX_WIDTH`. Secrets: `IDP_CLIENT_SECRET`, `RP_SESSION_SECRET`.

## Auth

OAuth RP of accounts. Does NOT run better-auth — SSO through `gdg-lib`'s `initializeRpAuth`. `lib/auth.server.ts` caches one `RpAuthInstance` per `env`.

- `requireUserWithChapter(env, request)` in `lib/auth-redirect.ts` is the standard route gate — returns `{ user, chapter, chapters, accountId }` (`chapter` = primary membership, `chapters` = every active membership) or throws `redirect("/signin?return_to=...")`. Use in every protected loader/action; build the image-service actor as `{ user, chapters }` (not `{ user, chapters: [chapter] }` — a user with several memberships must see images shared with any of them).
- `signin` route bounces to `/api/auth/signin` (handled by `getAuth().handleAuthRequest`). `safeReturnTo` validates local return-to (must start with `/` but not `//`; rejects control chars/whitespace).
- Chapter memberships fetched via `fetchChaptersForUser` (`lib/chapter.server.ts`) from `/userinfo`, cached in-memory 30s/user (LRU 500) as `{ primary, all }`. `fetchChapterForUser` is a thin wrapper returning just `primary`. `ClaimsUnavailableError` → sign-in redirect; no primary chapter → `/no-chapter`.
- Post-SSO-migration: NO `account` table — `user.id` is the stable internal UUID. New `images` rows store `user_id === account_id`; older rows keep historical `account_id` (Google `sub`) for back-compat reads. **Don't reintroduce an `account` table or join on `account_id`.**

## Image flow

- IDs: 8-char nanoid from `[0-9A-Za-z]`, collision retry in `generateUniqueImageId`. Validate inbound `:id` with `isValidImageId` before touching D1/R2.
- Upload (`api.upload.ts`): R2 first → D1 insert. On D1 failure, best-effort R2 cleanup via `ctx.waitUntil(deleteOriginal(...))`. **Keep ordering (R2 first, DB second, rollback R2 on DB error).**
- Public GET (`routes/$id.tsx`): no auth. Plain URLs automatically negotiate AVIF/WebP and optionally scale down to `IMG_AUTO_MAX_WIDTH`; `?f=original` returns the uploaded bytes. Canonical normalized renditions persist in `DERIVED`, with a synthetic Cache API key in front. ETags include variant, source version, normalized params, and format. Images failures fall back to originals rather than returning 500.
- Mutations (`api.replace.$id.ts`, `api.delete.$id.ts`, `api.move.$id.ts`, `api.share.$id.ts`, `api.slug.$id.ts`, `api.mobile.$id.ts`): gated by `canAccessImage` (`features/images/policy.ts`) — owner, `isSuperAdmin(user)`, OR any member of `image.chapterId`. This is the same check for reads and writes; there is no separate editor/viewer role. Replace reuses the same `r2_key` so the public URL is stable; gallery/detail cache-bust with `?v=${updatedAt}` (plus client-side counter on detail page).
- Folders (`features/folders/`): flat, chapter-owned (`folders.chapter_id`), no parent/hierarchy. `canAccessFolder` mirrors `canAccessImage` — any member of the folder's chapter. Assigning an image to a folder in a *different* chapter than the image is rejected (`folder_chapter_mismatch`); re-sharing an image to a new chapter (`api.share.$id.ts` / `setImageChapterForActor`) clears its `folder_id` as a side effect, since a folder can't span chapters. Re-sharing to a chapter the actor doesn't belong to requires `isSuperAdmin` (`canShareImageWithChapter`). `setImageSlug`/`setImageFolder`/`setImageChapter`/`updateImageAttributes` deliberately do NOT bump `updated_at`, so neither public ETags nor derived R2 storage are invalidated by metadata-only changes.
- Replacing bytes changes `updated_at`, making old rendition keys unreachable; cleanup is best effort. Mobile upload currently also bumps the row's `updated_at`, so default renditions are conservatively over-invalidated. Fixing that requires a separate `bytes_updated_at` column and is outside the current design.
- The CLI's combined `PATCH /api/cli/v1/images/:id` (any subset of `slug`/`folderId`/`chapterId`) goes through `updateImageForActor`, not the three single-field `*ForActor` functions above. It validates every field — including cross-field constraints like "does this folder belong to the chapter we're moving to?" — before issuing a single `UPDATE` (`updateImageAttributes`). **Don't reintroduce per-field sequential writes here**: an earlier field succeeding and a later one failing must never leave a partial change committed.
- Max upload: 10 MiB (`MAX_BYTES` in upload + replace). Content-type must start with `image/`.

## Routes

Order in `app/routes.ts` matters — catch-all public viewer `:id` is last so explicit routes (`signin`, `no-chapter`, `i/:id`, `api/*`, `auth/*`) match first. New top-level (non-`api/`) segments must be added to `RESERVED_SLUGS` in `features/images/slug.ts`, checked by `slug.test.ts`'s routes-consistency test; everything folder/chapter-sharing related lives under `api/*` so it doesn't need an entry.

CLI (`api/cli/v1/*`, bearer auth) mirrors the dashboard routes: `images` supports `folderId`/`chapterId` query and PATCH-body filters, `folders` is full CRUD. The Go client lives in `cli/internal/img/`; regenerate after any `openapi/` change with `pnpm openapi:generate && (cd cli/internal/img && go generate ./...)`.

## Tests

- Unit: Vitest, colocated `*.test.ts`. Currently minimal.
- E2E: Playwright in `e2e/`, baseURL `http://localhost:5175`. Only spec asserts home → `/signin?return_to=%2F` — keep that contract when changing the auth gate.
