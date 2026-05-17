# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file scopes to the `img/` app (`@gdgjp/img`, deployed at `img.gdgs.jp`). For monorepo-wide layout and conventions see `../CLAUDE.md`.

## What this app is

Image hosting service. Authenticated chapter members upload images; the resulting `img.gdgs.jp/<id>` URL is publicly viewable by anyone with the link (no auth on the public `:id` GET). Originals live in R2; on-the-fly resizing/format conversion is handled by Cloudflare Images (`IMAGES` binding) via `env.IMAGES.input(...).transform(...).output(...)`.

## App-specific commands

```
pnpm --filter @gdgjp/img dev            # vite dev on :5175
pnpm --filter @gdgjp/img test           # vitest
pnpm --filter @gdgjp/img test:e2e       # playwright; boots accounts on :5173 + img on :5175
pnpm --filter @gdgjp/img migrate:local  # apply migrations to local D1, then re-dump schema.sql
pnpm --filter @gdgjp/img cf-typegen     # regenerate worker-configuration.d.ts after wrangler.toml changes
```

E2E requires the `accounts` app to be reachable on `localhost:5173` — `playwright.config.ts` boots it via `pnpm --dir ../accounts dev`. The `webServer` block reuses an existing dev server outside CI, so you can leave both running.

## Bindings (wrangler.toml)

- `DB` — D1 (`gdgjp-img-db`). Schema in `migrations/` + dumped to `schema.sql`. Edit migrations, never the dump.
- `ORIGINALS` — R2 bucket. R2 keys equal the 8-char image id (see `lib/id.ts`).
- `IMAGES` — Cloudflare Images binding used for transforms; no separate cf-images upload step.

Vars: `APP_URL`, `ACCOUNTS_URL`, `IDP_URL`, `IDP_CLIENT_ID`. Secrets: `IDP_CLIENT_SECRET`, `RP_SESSION_SECRET` (set via `wrangler secret put` or `.dev.vars` locally).

## Auth model — important

This app is an OAuth **relying party** of `accounts.gdgs.jp`. It does NOT run `better-auth` directly — all SSO flow goes through `@gdgjp/gdg-lib`'s `initializeRpAuth`. `lib/auth.server.ts` caches one `RpAuthInstance` per `env`.

- `requireUserWithChapter(env, request)` in `lib/auth-redirect.ts` is the standard route gate: it returns `{ user, chapter, accountId }` or throws a `redirect("/signin?return_to=...")`. Use it in every protected loader/action.
- The local `signin` route just bounces to `/api/auth/signin` (handled by `getAuth().handleAuthRequest`). Local return-to values are validated by `safeReturnTo` to block open-redirects (must start with `/` but not `//`, and reject control chars/whitespace).
- The user's chapter membership is fetched from the IdP's `/userinfo` endpoint via `fetchChapterForUser` (`lib/chapter.server.ts`) and cached in-memory for 30s per user (LRU evict at 500). A `ClaimsUnavailableError` from the IdP also triggers the sign-in redirect; missing chapter sends to `/no-chapter`.
- Post-SSO-migration there is no separate `account` table — `user.id` is the stable internal UUID. New `images` rows store `user_id === account_id`; older rows keep their historical `account_id` (Google `sub`) for backward-compat reads. Don't reintroduce an `account` table or join on `account_id`.

## Image flow

- IDs: 8-char nanoid from `[0-9A-Za-z]`, generated with collision retry in `generateUniqueImageId`. Validate any inbound `:id` with `isValidImageId` before touching D1/R2.
- Upload (`api.upload.ts`): puts original to R2, then inserts the D1 row. On D1 failure it best-effort cleans up R2 via `ctx.waitUntil(deleteOriginal(...))` — keep that ordering (R2 first, DB second, rollback R2 on DB error).
- Public GET (`routes/$id.tsx`): no auth. Honors `If-None-Match` (etag is `"<id>-<updatedAt>"`), returns the R2 stream directly when no transform params are present, otherwise pipes through `env.IMAGES`. Cache headers are `public, max-age=300, s-maxage=86400`; format negotiation falls back to `Accept` and emits `Vary: Accept` when format is auto. Transform options accepted: `w`/`h` (≤4096), `fit`, `q` (1–100), `f` (auto|avif|webp|jpeg|png). See `lib/img-url.ts`.
- Mutations (`api.replace.$id.ts`, `api.delete.$id.ts`): gated by `canMutateImage` (owner OR `isSuperAdmin(user)` from gdg-lib). Replace reuses the same `r2_key` so the public URL is stable; the gallery and detail view cache-bust via `?v=${updatedAt}` (plus a client-side counter on the detail page).
- Max upload: 10 MiB (`MAX_BYTES` in both upload and replace). Content-type must start with `image/`.

## Routes

Order in `app/routes.ts` matters — the catch-all public viewer `:id` is last so explicit routes (`signin`, `no-chapter`, `i/:id`, `api/*`, `auth/*`) match first.

## Tests

- Unit: Vitest, files colocated as `*.test.ts` next to source. Currently minimal (just `routes/home.test.ts`).
- E2E: Playwright in `e2e/`, baseURL `http://localhost:5175`. The only spec asserts the home redirect to `/signin?return_to=%2F` — keep that contract intact when changing the auth gate.
