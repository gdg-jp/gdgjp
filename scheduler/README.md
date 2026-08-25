# Scheduler

Meeting scheduler at `scheduler.gdgs.jp`. A user sets a title, a weekly availability grid, and a
meeting length; participants open the resulting URL and mark which slots work for them. React
Router v7 SSR on Cloudflare Workers, D1-backed, no local IdP — sign-in is delegated to `accounts/`.

## User model

Anonymous use is first-class:

- Anyone can create an event (`/`, `routes/events.new.tsx`) without signing in. `owner_user_id` is
  set from the session if present, otherwise left `NULL`.
- Anyone can open an event (`/e/:id`) and record their own availability without signing in.
  Anonymous participants are identified by a per-event cookie, `scheduler_p_<eventId>`, containing
  `<participantId>.<token>`; only the SHA-256 hash (`edit_token_hash`) is stored server-side, and
  the cookie's `Path` is scoped to `/e/<eventId>` so each event gets its own anonymous identity.
- Signing in (via `accounts/`) adds cross-device continuity: a stable `user_id` on the
  participant row instead of a cookie, a "My events" list (`/events`) of events owned by that
  user, and owner-only edit (`/e/:id/edit`) and soft-delete (`/e/:id/delete`).

`resolveCurrentParticipant` in `app/routes/e.$id.tsx` is the canonical identity lookup for a
request: prefer the signed-in user, fall back to the validated cookie. Owner-only mutations
(`updateEventForOwner`, `softDeleteEvent` in `app/lib/db.ts`) take `ownerUserId` and no-op unless
it matches `owner_user_id`. Deletes are soft (`deleted_at`); every read filters
`deleted_at IS NULL`.

## Tech stack

- React Router v7 (framework mode, SSR) on Cloudflare Workers
- D1 for events, slots, participants, availabilities, and the local `user` mirror
- `@gdgjp/gdg-lib` (`initializeRpAuth`) for OIDC against `accounts/`
- Tailwind v4, Radix UI primitives, `motion` for transitions
- Vitest for unit tests, Playwright for e2e

### Cloudflare bindings (`wrangler.toml`)

| Binding  | Type          | Notes                                             |
| -------- | ------------- | -------------------------------------------------- |
| `ASSETS` | Assets        | `./build/client`                                    |
| `DB`     | D1            | `gdgjp-scheduler-db`, migrations in `./migrations`  |

`[vars]` sets `APP_URL`, `ACCOUNTS_URL`, `IDP_URL` (all `accounts.gdgs.jp` in prod), and
`IDP_CLIENT_ID = "scheduler"`. Worker entrypoint is `./workers/app.ts`.

## Directory structure

```
app/
  routes.ts               # flat route table (framework mode)
  routes/
    home.tsx               # event creation form (anonymous-friendly)
    events.new.tsx         # action: create event + slots, redirect to /e/:id
    events.tsx             # "My events" — requireUser, owner's events only
    e.$id.tsx               # event view: join, mark availability, resolveCurrentParticipant
    e.$id.edit.tsx           # owner-only edit
    e.$id.delete.ts          # owner-only soft delete
    signin.tsx               # redirects into /api/auth/signin with return_to
    api.auth.$.ts             # passthrough to gdg-lib's handleAuthRequest
    auth.signout.ts           # passthrough to gdg-lib's handleSignOutRedirect
  lib/
    auth.server.ts           # initializeRpAuth wiring, cached per-env
    auth-redirect.server.ts  # requireUser / getOptionalUser (redirect-on-401 wrapper)
    db.ts                    # all D1 queries: *Row types, toX mappers, column-list constants
    slots.ts                 # day/time slot model, TIME_OPTIONS, deriveDayRanges
    participant-cookie.ts    # anon participant cookie sign/verify
    validate.ts               # form parsing for event creation
    return-to.ts              # safeReturnTo (same-origin redirect guard)
workers/app.ts               # Worker entrypoint
migrations/                  # D1 schema, numbered; schema.sql is generated — do not hand-edit
e2e/                          # Playwright specs
```

## Local development

Copy `.dev.vars.example` to `.dev.vars` and fill in the secrets:

```
RP_SESSION_SECRET=   # HMAC key for the RP's signed session + OIDC transaction cookies
                      # generate with: openssl rand -base64 48
IDP_CLIENT_SECRET=   # client secret issued by the accounts IdP for this RP
```

`.dev.vars.example` also overrides `APP_URL`, `ACCOUNTS_URL`, and `IDP_URL` to point at a local
`accounts/` dev server (`http://localhost:5173`) so `wrangler dev` doesn't hit prod. This app's dev
server runs on port 5176. If the Accounts OAuth client id, secret, or redirect URI ever changes,
reseed it via `/admin/seed-clients` on the `accounts/` worker before testing sign-in here.

```sh
pnpm --filter @gdgjp/scheduler dev              # :5176
pnpm --filter @gdgjp/scheduler build
pnpm --filter @gdgjp/scheduler deploy
pnpm --filter @gdgjp/scheduler typecheck        # wrangler types + react-router typegen + tsc
pnpm --filter @gdgjp/scheduler migrate:local    # apply D1 migrations locally, dump schema.sql
pnpm --filter @gdgjp/scheduler migrate:remote   # apply D1 migrations to prod, dump schema.sql
```

Re-run `typecheck` after editing `wrangler.toml` bindings.

## Testing

Unit tests (Vitest, `app/**/*.test.ts`) cover the parts most sensitive to correctness:
`app/lib/db.test.ts`, `app/lib/slots.test.ts` (day/time grid), `app/lib/reconcile.test.ts` (slot
diffing on event edit), `app/lib/participant-cookie.test.ts` (anon identity), `app/lib/id.test.ts`,
and `app/lib/validate.test.ts`.

```sh
pnpm --filter @gdgjp/scheduler test
```

Playwright e2e specs live in `e2e/`. Prefer repo-root `pnpm ci:quick` / `pnpm ci:full` during
development; `pnpm test:e2e` for this package boots both this app (:5176) and `accounts/` (:5173)
as `accounts/` must be reachable for sign-in flows to work.
