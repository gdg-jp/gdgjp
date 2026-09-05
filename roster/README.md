# @gdgjp/roster

Staff shift-schedule generator for GDG Japan events, deployed at `roster.gdgs.jp`. Owners define
an event's time slots, tracks, roles, and headcount needs; staff volunteers self-register through
a public link; roster auto-generates a draft schedule (respecting hard constraints like "never
double-book a slot" and skill-mix rules like "no newcomer working alone"), and owners hand-edit
the result before publishing a read-only shared view.

Full product plan: [`docs/roster/index.md`](../docs/roster/index.md). Design decisions:
[`docs/roster/adr.md`](../docs/roster/adr.md).

## Status

**Stage 01 of 9 — workspace scaffold only.** This PR gets the app to "sign-in works, chapter gate
works" and nothing else. No event, schedule, demand, application, solver, or roster screen exists
yet; every one of those is a later stage (see `docs/roster/index.md` §7 for the stage graph).

## Screens (once later stages land)

| Screen | Path | Auth |
|---|---|---|
| Event list | `/` | Chapter required |
| Design (time slots / tracks / roles / demand) | `/e/:id/design` | Chapter required |
| Recruiting / staff | `/e/:id/staff` | Chapter required |
| Shift schedule | `/e/:id/roster` | Chapter required |
| Share | `/e/:id/share` | Chapter required |
| Staff registration (public) | `/apply/:applyToken` | Sign-in only, no chapter |
| Public shift view | `/r/:viewToken` | None |

Today only the auth plumbing exists: `/` (placeholder), `/signin`, `/no-chapter`,
`/api/auth/*`, `/auth/signout`, `/dev/login`, `/dev/seed`.

## How it works

React Router v7 (SSR) on a Cloudflare Worker, scaffolded from `ost/` (ADR-001). D1 (`DB`) holds
the relying-party auth tables today; domain tables (`events`, `time_slots`, `tracks`, `roles`,
`demands`, `applications`, `assignments`, `revisions`, ...) land starting Stage 02. No ORM —
hand-written D1 queries once Stage 02 adds `app/lib/db.server.ts`. The shift-generation solver
(Stage 06) is a pure TypeScript module with no D1 or React dependency, run from a Worker action.

Full conventions and file-level notes are in `CLAUDE.md`; the code map is in `ARCHITECTURE.md`.

## Local development

```sh
pnpm --filter @gdgjp/roster migrate:local   # apply D1 migrations to the local database
pnpm --filter @gdgjp/roster dev             # http://localhost:5186
```

Create `roster/.dev.vars` from `.dev.vars.example` (`RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`).
For real sign-in also run `pnpm --filter @gdgjp/accounts dev` (port 5173) and
`POST http://localhost:5173/admin/seed-clients`. Otherwise use
`/dev/login?as=owner&chapter=1:x&return_to=/` (non-production only).

## Deploy

```sh
pnpm --filter @gdgjp/roster run deploy   # wrangler deploy
```

Prerequisites: a proxied `roster` DNS record in the `gdgs.jp` zone; a D1 database
(`wrangler d1 create gdgjp-roster-db`, then set its id in `wrangler.toml` — this PR ships a
placeholder id, see the PR description's deploy-steps section); `wrangler secret put
RP_SESSION_SECRET` and `wrangler secret put IDP_CLIENT_SECRET`; and the `roster` OIDC client
registered on the `accounts` worker (`ROSTER_CLIENT_ID` / `ROSTER_REDIRECT_URLS` vars,
`ROSTER_CLIENT_SECRET` secret, `POST /admin/seed-clients`). CI runs `deploy` on merge to `main`
when `roster/` changes.
