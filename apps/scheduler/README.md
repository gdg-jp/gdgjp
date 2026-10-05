# Scheduler

Meeting scheduler at `scheduler.gdgs.jp`. A user sets a title, a weekly availability grid, and a
meeting length; participants open the resulting URL and mark which slots work for them. React
Router v7 SSR on Cloudflare Workers, D1-backed, no local IdP — sign-in is delegated to `accounts/`.

## User model

Anonymous use is first-class:

- Anyone can create an event (`/`, `routes/events/new.tsx`) without signing in. `owner_user_id` is
  set from the session if present, otherwise left `NULL`.
- Anyone can open an event (`/e/:id`) and record their own availability without signing in.
  Anonymous participants are identified by a per-event cookie, `scheduler_p_<eventId>`, containing
  `<participantId>.<token>`; only the SHA-256 hash (`edit_token_hash`) is stored server-side, and
  the cookie's `Path` is scoped to `/e/<eventId>` so each event gets its own anonymous identity.
- Signing in (via `accounts/`) adds cross-device continuity: a stable `user_id` on the
  participant row instead of a cookie, a "My events" list (`/events`) of events owned by that
  user, and owner-only edit (`/e/:id/edit`) and soft-delete (`/e/:id/delete`).

`resolveCurrentParticipant` in `app/features/participants/event.server.ts` is the canonical identity lookup for a
request: prefer the signed-in user, fall back to the validated cookie. Owner-only mutations
(`updateEventForOwner`, `softDeleteEvent` in `app/features/events/repository.server.ts`) take `ownerUserId` and no-op unless
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
    events/
      create.tsx             # event creation form (anonymous-friendly)
      new.tsx                # action: create event + slots
      list.tsx               # owner's events
      edit.tsx               # owner-only edit
      delete.ts              # owner-only soft delete
    participants/event.tsx   # event view and availability responses
    signin.tsx               # redirect into /api/auth/signin
    api.auth.$.ts            # auth passthrough
    auth.signout.ts          # sign-out passthrough
  features/
    auth/                    # OIDC wiring, sessions, same-origin redirect guard
    events/                  # event lifecycle, form validation, bundle read model
    scheduling/              # slots, reconciliation, schedule editor and slot grid
    participants/            # participant persistence, cookie identity and availability responses
  lib/                       # cross-cutting theme and class-name helpers only
  layouts/                   # composed application header
  components/                # domain-free UI primitives
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

Unit tests (Vitest, `app/**/*.test.ts`) sit beside their feature modules and cover event
mapping, form validation, slot calculations/reconciliation, anonymous cookie identity, and IDs.
`app/architecture.test.ts` enforces feature ownership and import boundaries. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the code map.

```sh
pnpm --filter @gdgjp/scheduler test
```

Playwright e2e specs live in `e2e/`. Prefer repo-root `pnpm ci:quick` / `pnpm ci:full` during
development; `pnpm test:e2e` for this package boots both this app (:5176) and `accounts/` (:5173)
as `accounts/` must be reachable for sign-in flows to work.
