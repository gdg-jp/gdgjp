# @gdgjp/ost

Support app for running **Open Space Technology (OST)** sessions at GDG Japan events, deployed at
`ost.gdgs.jp`. OST is an attendee-driven unconference: the participants propose the session
topics on the spot, vote on them, and the top topics are placed on the venue's tables.

## Screens

- **`/:slug` — participant view.** Opened by attendees on their phones. Deliberately bare: one
  text field to propose a topic, plus an **投票する** button that opens a dialog for 👍-voting on
  every topic (one vote per topic, retractable; tracked by an anonymous per-browser cookie).
  Public — no sign-in.
- **`/:slug/screen` — projector: topics.** Presentation-slide layout in GDG's visual identity
  (`#EEEEEE` ground, white cards, solid `#000` border, large radius, four Google colors).
  Topics appear in real time. Drag one card onto another to **merge** near-duplicate topics into
  a stack; tap a stack to spread its members over a dimmed backdrop.
- **`/:slug/tables` — projector: desk assignments.** Shows the venue layout with each desk and
  the topic assigned to it.
- **`/:slug/edit` — event settings.** Build the desk layout (add / drag / resize / rotate),
  run **auto-assign** (top-voted topics → desks, ties broken by submission order), and manage
  topics.
- **`/` — dashboard.** Create events (each gets its own `:slug` and belongs to a GDG chapter)
  and jump to their pages.

All admin surfaces (`/`, `/:slug/screen`, `/:slug/tables`, `/:slug/edit`) require **GDG Accounts
sign-in and membership of the event's chapter** — any member of that chapter can view and edit.
Participant pages stay public.

## How it works

React Router v7 (SSR) on a Cloudflare Worker.

- **D1 (`DB`)** holds the relying-party auth tables and an `events` registry only.
- Each event's live state — topics, votes, merge groups, desks — is a **per-slug Durable
  Object** (`OstBoard`, `getByName(slug)`), using its own SQLite storage. It broadcasts a full
  state snapshot to every connected screen (`/ws?board=<slug>`, hibernatable WebSockets) on
  every change; loaders also SSR the current state so screens are populated before the socket
  connects.
- A participant submission / vote is a form `POST` to `/:slug`; the route action calls the
  Durable Object's `submitTopic` / `toggleVote` RPC.
- Pure logic (topic validation, slug rules, vote tally, unit scoring, auto-assign ordering, desk
  geometry) lives in `app/lib/*` and is unit-tested. Durable Object behaviour is covered by
  `e2e/`.

Full conventions and file-level notes are in `CLAUDE.md`.

## Local development

```sh
pnpm --filter @gdgjp/ost migrate:local   # apply D1 migrations to the local database
pnpm --filter @gdgjp/ost dev             # http://localhost:5185
```

Create `ost/.dev.vars` from `.dev.vars.example` (`RP_SESSION_SECRET`, `IDP_CLIENT_SECRET`).
For real sign-in also run `pnpm --filter @gdgjp/accounts dev` (port 5173) and
`POST http://localhost:5173/admin/seed-clients`. Otherwise use
`/dev/login?as=owner&chapter=1:dev-chapter&return_to=/…` (non-production only) and
`/dev/seed?slug=demo` to create an event without the dashboard.

## Deploy

```sh
pnpm --filter @gdgjp/ost run deploy   # wrangler deploy
```

Prerequisites: a proxied `ost` DNS record in the `gdgs.jp` zone; a D1 database
(`wrangler d1 create gdgjp-ost-db`, then set its id in `wrangler.toml`);
`wrangler secret put RP_SESSION_SECRET` and `wrangler secret put IDP_CLIENT_SECRET`; and the
`ost` OIDC client registered on the `accounts` worker (`OST_CLIENT_ID` / `OST_REDIRECT_URLS`
vars, `OST_CLIENT_SECRET` secret, `POST /admin/seed-clients`). CI runs `deploy` on merge to
`main` when `ost/` changes.
