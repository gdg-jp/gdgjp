# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This file is scoped to the `tinyurl/` app. Monorepo-wide conventions (Biome, workspace layout, deployment, shared `@gdgjp/gdg-lib`) live in `../CLAUDE.md` — don't repeat them here.

## App at a glance

`@gdgjp/tinyurl` (url.gdgs.jp) is a React Router v7 SSR app on Cloudflare Workers that issues short URLs and tracks clicks. Two Worker bindings carry the app:

- `DB` — D1 (`gdgjp-tinyurl-db`). Schema in `migrations/`, post-migration dump in `schema.sql` (generated).
- `CLICKS_AE` — Analytics Engine dataset `tinyurl_clicks`. Click events are written via `writeDataPoint` (one row per redirect) and read back over the AE SQL API for `/analytics` and `/dashboard`. Reading requires `CF_ACCOUNT_ID` + `CF_AE_API_TOKEN` secrets (Account → Account Analytics: Read); writes need no secrets.

`wrangler.toml` mounts the Worker on **two zone routes**: `url.gdgs.jp/*` (the app UI) and `gdgs.jp/*` (the short-link apex). The apex/`/r/*` fast path is handled in `workers/app.ts` **before** React Router sees the request — see below.

## Request flow

1. `workers/app.ts` runs `isApexRedirect(request, env)` first. If `Host` matches `SHORT_URL_BASE`'s host, or the path starts with `/r/`, it extracts the slug and calls `handleApexRedirect()` (`app/lib/redirect-handler.ts`), which looks up the link by slug, fires `ctx.waitUntil(writeClickEvent(...))`, and returns a 302 to `destination_url`. No RR involvement.
2. Otherwise the request flows into `createRequestHandler` with a `CloudflareContext` (`workers/context.ts`) that exposes `env`/`ctx` on `context.cloudflare` inside loaders/actions. Routes are registered in `app/routes.ts`; the catch-all `:slug` route handles the app-host case for slugs (returns 404 if the host isn't the apex — the apex path is the canonical one).

When changing how slugs resolve, change both paths or you'll get host-dependent behavior.

## Auth model

OAuth client of the `accounts/` IdP, wired through `@gdgjp/gdg-lib`'s `initializeRpAuth` in `app/lib/auth.server.ts` (cookie prefix `gdgjp-tinyurl`, secret `RP_SESSION_SECRET`). There is **no local password/account table** — the `user` table is only a userinfo cache (see migrations 0006–0015 for the history of stripping better-auth tables down to this).

Chapter membership comes from the IdP's `/userinfo`, not from the DB. `app/lib/chapter.server.ts` calls `getFreshClaims(request)` and caches the result in-process for 30 s per user.

Authorization for individual links lives in `app/lib/permissions.ts`:

- A user with a non-null `link.owner_chapter_id` matching their primary chapter id is treated as a chapter co-owner.
- `link_permissions` rows grant `editor` or `viewer` access to a `principal_id` that is either an **email** (`principal_type='user'`) or a chapter id stringified (`principal_type='chapter'`). The email-as-principal is intentional — it lets you share with a user before they've ever signed in.
- `link.visibility = 'public'` grants view access to any signed-in member.
- `isSuperAdmin(user)` short-circuits both view and edit.

## Link IDs and slugs

Link primary keys are ULID-shaped: `link_<26-char Crockford ULID>`. The regex `LINK_ID_RE` in `app/lib/analytics-engine.ts` is the authoritative format and is used to sanitize values interpolated into AE SQL (AE has no parameter binding — see `quote()` / `intOrThrow()` / `linkIdOrThrow()` in the same file). If you add a new dimension filter, add an analogous validator before string-concatenating it into SQL.

Slugs are user-supplied unique strings; `createLink` distinguishes the unique-constraint violation and returns `{ ok: false, reason: "slug_taken" }` rather than throwing.

## Commands (in addition to the root-level ones)

```
pnpm --filter @gdgjp/tinyurl dev          # vite on :5174
pnpm --filter @gdgjp/tinyurl test         # vitest (node env)
pnpm --filter @gdgjp/tinyurl test:e2e     # playwright; boots accounts dev (:5173) + this dev (:5174)
pnpm --filter @gdgjp/tinyurl typecheck    # wrangler types && rr typegen && tsc --noEmit
pnpm --filter @gdgjp/tinyurl migrate:local  # apply migrations to local D1 + regenerate schema.sql
```

Single test:

```
pnpm --filter @gdgjp/tinyurl exec vitest run app/lib/permissions.test.ts
pnpm --filter @gdgjp/tinyurl exec playwright test e2e/home.spec.ts
```

E2E note: `playwright.config.ts` boots **both** `accounts` (port 5173) and `tinyurl` (port 5174) via `webServer`. If something looks like a flake, check both dev servers came up.

## Dev secrets

`.dev.vars` (gitignored) needs `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`, and — for the analytics pages to render — `CF_ACCOUNT_ID` / `CF_AE_API_TOKEN`. Local URL overrides (`APP_URL`, `IDP_URL`, `SHORT_URL_BASE=http://localhost:5174`) point the Worker at the local accounts IdP and treat the dev host as the short-link apex so the `isApexRedirect` path is exercisable in dev. See `.dev.vars.example`.
