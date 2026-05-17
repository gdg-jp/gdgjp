# CLAUDE.md — `@gdgjp/img`

img.gdgs.jp. Repo-wide conventions in `../CLAUDE.md`.

Image hosting. Authenticated chapter members upload; `img.gdgs.jp/<id>` is publicly viewable (no auth on the public `:id` GET). Originals in R2; on-the-fly resize/format via Cloudflare Images `IMAGES` binding (`env.IMAGES.input(...).transform(...).output(...)`).

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
- `IMAGES` — Cloudflare Images binding for transforms (no separate upload step).

Vars: `APP_URL`, `ACCOUNTS_URL`, `IDP_URL`, `IDP_CLIENT_ID`. Secrets: `IDP_CLIENT_SECRET`, `RP_SESSION_SECRET`.

## Auth

OAuth RP of accounts. Does NOT run better-auth — SSO through `gdg-lib`'s `initializeRpAuth`. `lib/auth.server.ts` caches one `RpAuthInstance` per `env`.

- `requireUserWithChapter(env, request)` in `lib/auth-redirect.ts` is the standard route gate — returns `{ user, chapter, accountId }` or throws `redirect("/signin?return_to=...")`. Use in every protected loader/action.
- `signin` route bounces to `/api/auth/signin` (handled by `getAuth().handleAuthRequest`). `safeReturnTo` validates local return-to (must start with `/` but not `//`; rejects control chars/whitespace).
- Chapter membership fetched via `fetchChapterForUser` (`lib/chapter.server.ts`) from `/userinfo`, cached in-memory 30s/user (LRU 500). `ClaimsUnavailableError` → sign-in redirect; missing chapter → `/no-chapter`.
- Post-SSO-migration: NO `account` table — `user.id` is the stable internal UUID. New `images` rows store `user_id === account_id`; older rows keep historical `account_id` (Google `sub`) for back-compat reads. **Don't reintroduce an `account` table or join on `account_id`.**

## Image flow

- IDs: 8-char nanoid from `[0-9A-Za-z]`, collision retry in `generateUniqueImageId`. Validate inbound `:id` with `isValidImageId` before touching D1/R2.
- Upload (`api.upload.ts`): R2 first → D1 insert. On D1 failure, best-effort R2 cleanup via `ctx.waitUntil(deleteOriginal(...))`. **Keep ordering (R2 first, DB second, rollback R2 on DB error).**
- Public GET (`routes/$id.tsx`): no auth. Honors `If-None-Match` (etag = `"<id>-<updatedAt>"`). Returns R2 stream directly with no transform params; else pipes through `env.IMAGES`. Cache: `public, max-age=300, s-maxage=86400`. Format negotiation falls back to `Accept`; emits `Vary: Accept` when format is auto. Transforms: `w`/`h` (≤4096), `fit`, `q` (1–100), `f` (auto|avif|webp|jpeg|png). See `lib/img-url.ts`.
- Mutations (`api.replace.$id.ts`, `api.delete.$id.ts`): gated by `canMutateImage` (owner OR `isSuperAdmin(user)` from gdg-lib). Replace reuses the same `r2_key` so the public URL is stable; gallery/detail cache-bust with `?v=${updatedAt}` (plus client-side counter on detail page).
- Max upload: 10 MiB (`MAX_BYTES` in upload + replace). Content-type must start with `image/`.

## Routes

Order in `app/routes.ts` matters — catch-all public viewer `:id` is last so explicit routes (`signin`, `no-chapter`, `i/:id`, `api/*`, `auth/*`) match first.

## Tests

- Unit: Vitest, colocated `*.test.ts`. Currently minimal.
- E2E: Playwright in `e2e/`, baseURL `http://localhost:5175`. Only spec asserts home → `/signin?return_to=%2F` — keep that contract when changing the auth gate.
