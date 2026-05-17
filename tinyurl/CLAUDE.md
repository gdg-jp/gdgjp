# CLAUDE.md — `@gdgjp/tinyurl`

Scoped to `tinyurl/`. Monorepo-wide conventions in `../CLAUDE.md`.

## Bindings

- `DB` — D1 `gdgjp-tinyurl-db` (schema in `migrations/`, dumped to `schema.sql`).
- `CLICKS_AE` — Analytics Engine dataset `tinyurl_clicks`. Writes via `writeDataPoint` (no secrets); reads via AE SQL API need `CF_ACCOUNT_ID` + `CF_AE_API_TOKEN` (Account Analytics: Read).

## Request flow — apex fast path

`wrangler.toml` mounts on two zone routes: `url.gdgs.jp/*` (UI) and `gdgs.jp/*` (short-link apex).

1. `workers/app.ts` runs `isApexRedirect(request, env)` first. If `Host` matches `SHORT_URL_BASE`'s host OR path starts with `/r/`, it extracts the slug and calls `handleApexRedirect()` (`app/lib/redirect-handler.ts`): looks up by slug, `ctx.waitUntil(writeClickEvent(...))`, returns 302 to `destination_url`. No RR.
2. Otherwise → `createRequestHandler`. Catch-all `:slug` route handles app-host slug requests (404 if host isn't the apex).

**When changing slug resolution, change both paths** or behavior becomes host-dependent.

## Auth

OAuth RP of `accounts/` via `gdg-lib`'s `initializeRpAuth` in `app/lib/auth.server.ts`. Cookie prefix `gdgjp-tinyurl`. `RP_SESSION_SECRET` for HMAC. **No local password/account table** — `user` is a userinfo cache only (migrations 0006–0015 stripped better-auth down to it).

Chapter membership comes from the IdP `/userinfo`, not DB. `app/lib/chapter.server.ts` calls `getFreshClaims(request)` and caches per-user in-process for 30s.

Authorization (`app/lib/permissions.ts`):

- Non-null `link.owner_chapter_id` matching user's primary chapter → chapter co-owner.
- `link_permissions` grants `editor`/`viewer` to `principal_id` that is either email (`principal_type='user'`) or chapter id string (`principal_type='chapter'`). **Email-as-principal is intentional** — lets you share before first sign-in.
- `link.visibility = 'public'` → any signed-in member can view.
- `isSuperAdmin(user)` short-circuits both view and edit.

## Link IDs / slugs

Link PKs are `link_<26-char Crockford ULID>`. `LINK_ID_RE` in `app/lib/analytics-engine.ts` is authoritative and used to sanitize values into AE SQL (AE has no parameter binding — see `quote()` / `intOrThrow()` / `linkIdOrThrow()`). New dimension filters MUST add an analogous validator before string-concat into SQL.

Slugs are user-supplied unique. `createLink` distinguishes unique-violation and returns `{ ok: false, reason: "slug_taken" }`.

## Dev

`.dev.vars` needs `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`, and (for analytics pages) `CF_ACCOUNT_ID` / `CF_AE_API_TOKEN`. Set local URL overrides `APP_URL` / `IDP_URL` / `SHORT_URL_BASE=http://localhost:5174` so the apex path is exercisable in dev. See `.dev.vars.example`.

E2E (`playwright.config.ts`) boots BOTH `accounts` (:5173) and `tinyurl` (:5174) via `webServer`. Flake? Check both came up.
