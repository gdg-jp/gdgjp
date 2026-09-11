# @gdgjp/roster

Staff shift-schedule generator for GDG Japan events, deployed at `roster.gdgs.jp`. Owners define
an event's time slots, tracks, roles, and headcount needs; staff volunteers self-register through
a public link; roster auto-generates a draft schedule (respecting hard constraints like "never
double-book a slot" and skill-mix rules like "no newcomer working alone"), and owners hand-edit
the result before publishing a read-only shared view.

Full product plan: [`docs/roster/index.md`](../docs/roster/index.md). Design decisions:
[`docs/roster/adr.md`](../docs/roster/adr.md).

## Status

**Stage 09 of 9 — share and public views. The final stage.** Stages 01/02 got the app to "sign-in
works, chapter gate works, an event's schedule can be designed"; Stage 03 added demand input
(`/e/:id/design`'s demand matrix); Stage 04 added staff self-registration through a public link
(`/apply/:applyToken`, ADR-008) and the owner-side proxy-add entry point; Stage 05 cross-checked
demand against applications (`app/features/supply/`) and finished `/e/:id/staff`; Stage 06 built
the shift-generation solver as a pure module; Stage 07 wired it all together (`assignments`, the
3-view `/e/:id/roster` grid, manual editing). Stage 08 (revision history / undo-redo on
`/e/:id/roster`) was developed in parallel with this stage from the same Stage 07 baseline — see
its own PR for status. **This stage** ships the one fully public, unauthenticated screen
the whole product exists to produce: `/r/:viewToken` (staff grid / role grid / individual timeline
/ party list — no experience level or contact info anywhere, ADR-005) and `/e/:id/share` (the
owner-side URL-copy card). See `docs/roster/index.md` §7 for the full stage
graph.

## Screens

| Screen | Path | Auth | Status |
|---|---|---|---|
| Event list | `/` | Chapter required | Done (Stage 02) |
| Event creation | `/events/new` | Chapter required | Done (Stage 02) |
| Design (time slots / tracks / roles) | `/e/:id/design` | Chapter required | Done (Stage 02/03) |
| Recruiting / staff | `/e/:id/staff` | Chapter required | Done (Stage 04/05): apply URL + status, proxy-add, staff list, owner corrections, supply-demand view |
| Shift schedule | `/e/:id/roster` | Chapter required | Done (Stage 07): generate, 3 views, manual edit; Stage 08 (parallel) adds history |
| Share | `/e/:id/share` | Chapter required | Done (Stage 09): view-URL copy and status |
| Staff registration (public) | `/apply/:applyToken` | Sign-in only, no chapter | Done (Stage 04) |
| Public shift view | `/r/:viewToken` | None | Done (Stage 09): staff/role/individual/party tabs |

Routes today: `/`, `/events/new`, `/e/:id/design`, `/e/:id/staff`, `/e/:id/roster`,
`/e/:id/share`, `/apply/:token`, `/r/:token`, `/signin`, `/no-chapter`, `/api/auth/*`,
`/auth/signout`, `/dev/login`, `/dev/seed`.

## How it works

React Router v7 (SSR) on a Cloudflare Worker, scaffolded from `ost/` (ADR-001). D1 (`DB`) holds
the relying-party auth tables, the Stage 02 domain schema (`events`, `phases`, `time_slots`,
`tracks`, `roles` seeded per ADR-007, `event_roles`), the Stage 03 demand schema (`demands`), the
Stage 04 registration schema (`applications`, `application_skills`, `availabilities` — two UNIQUE
indexes enforce ADR-008's proxy-registration dedup), and the Stage 07 shift table (`assignments` —
`PRIMARY KEY (application_id, time_slot_id)` makes double-booking structurally impossible). Stage
08 (parallel) adds a `revisions` history table. **Stage 09 adds no table** — `/r/:viewToken` and
`/e/:id/share` (`app/features/public-roster/`) only read through the accessors those stages
already built, reshaped into a deliberately smaller public data surface (ADR-005: no PII, no
experience level, ever — enforced by a dedicated architecture test, not just UI review). No ORM —
every feature hand-writes D1 queries in its own `*.server.ts` (`app/lib/db.server.ts` is only a D1
handle accessor). The shift-generation solver (Stage 06) is a pure TypeScript module with no D1 or
React dependency, run from a Worker action.

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
pnpm --filter @gdgjp/roster build
pnpm --filter @gdgjp/roster run deploy   # wrangler deploy
```

Prerequisites: the `roster.gdgs.jp` Custom Domain attached to the Worker (the `[[routes]]`
entry remains alongside it, matching the other Cloudflare services); the `gdgjp-roster-db` D1
database bound by the committed id in `wrangler.toml`; the `RP_SESSION_SECRET` and
`IDP_CLIENT_SECRET` Worker secrets; and the `roster` OIDC client registered on the `accounts`
worker (`ROSTER_CLIENT_ID` / `ROSTER_REDIRECT_URLS` vars, `ROSTER_CLIENT_SECRET` secret,
`POST /admin/seed-clients`). CI runs `deploy` and then `migrate:remote` on merge to `main` when
`roster/` changes.
