# @gdgjp/ost

Support app for running **Open Space Technology (OST)** sessions at GDG Japan events, deployed at
`ost.gdgs.jp`. OST is an attendee-driven unconference format: instead of a fixed programme, the
participants propose the session topics themselves, on the spot. This app collects those
proposals from the room and shows them on the projector as they arrive.

There are two screens, and each one is shaped by how it is used:

- **`/` — participant view.** Opened by attendees on their own phones. It is deliberately
  bare: a single text field and a submit button, nothing else, so anyone can put a topic up in a
  few seconds without instructions.
- **`/admin` — facilitator view.** Projected on the room screen. Because it is a projection and
  not a normal web page, it is laid out like a presentation slide — very large type — and uses
  GDG's visual identity: an `#EEEEEE` background, white cards with a solid `#000` border and a
  large corner radius, accented with the four Google brand colors. Submitted topics appear in
  real time; the facilitator can delete an individual topic or clear the whole board between
  rounds.

Both screens are public — there is no `accounts/` sign-in. By design the whole thing runs on
**Cloudflare Workers plus a single Durable Object**.

## How it works

React Router v7 (SSR) on a Cloudflare Worker, with one Durable Object, `OstBoard`, as the entire
backend — there is no D1. Topics are kept in the Durable Object's own SQLite storage.

- The `/admin` screen opens a hibernatable WebSocket to `/ws`. `workers/app.ts` forwards that
  upgrade to the Durable Object, which sends a `snapshot` on connect and then broadcasts
  `added` / `deleted` / `cleared` events to every connected screen. The `loader` also
  server-renders the current list so the board is populated before the socket connects.
- A participant submission is a plain form `POST` to `/`; the route action calls the Durable
  Object's `submitTopic` RPC method, which stores the topic and broadcasts it.
- Input validation (trim, collapse whitespace, 200-character cap) lives in `app/lib/topics.ts`
  (`normalizeTopicText`) and is unit-tested.

Full package conventions and file-level notes are in `CLAUDE.md`; this file is the onboarding
summary.

## Local development

```sh
pnpm --filter @gdgjp/ost dev   # http://localhost:5185
```

No `.dev.vars` is required. The Durable Object's storage persists under `.wrangler/` between
runs, so submitted topics survive a restart.

## Deploy

```sh
pnpm --filter @gdgjp/ost run deploy   # wrangler deploy
```

CI runs this automatically on merge to `main` whenever `ost/` changes. The Worker route
`ost.gdgs.jp/*` is bound on deploy; the one remaining prerequisite is a **proxied `ost` DNS
record in the `gdgs.jp` zone** so the hostname resolves.
