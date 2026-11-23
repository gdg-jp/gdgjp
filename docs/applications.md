# Application map

Paths in this document are relative to the repository root. This is a lookup reference;
read only the relevant application entry and its local instructions when working on it.

Applications live in `apps/` and shared libraries in `packages/`. Workspace globs in
`pnpm-workspace.yaml` includes `apps/*` and `packages/*`:

- `apps/accounts/` is the GDG Accounts OAuth/OIDC identity provider on Cloudflare Workers, backed by
  D1 and KV.
- `apps/tinyurl/`, `apps/img/`, `apps/scheduler/`, `apps/sns/`, `apps/connpass/`, `apps/pay/`, and `apps/wiki/` are React Router v7 SSR
  Cloudflare Workers and relying parties of `apps/accounts/` (connpass is Bearer-API oriented for
  CLI/agents; `apps/ost/` and `apps/roster/` below are relying parties for their admin surfaces only). They
  keep routes in
  `app/routes/`, route registration in `app/routes.ts`, Worker entrypoints in `workers/`, and D1
  migrations in `migrations/`.
  `apps/wiki/` additionally uses R2, Queues, Browser Rendering, Workers AI, Vectorize, and a Durable
  Object; `apps/img/` uses R2 and Cloudflare Images; `apps/sns/` uses D1, R2, scheduled publishing, and X
  and Google Photos integrations; `apps/connpass/` uses D1, KV, Queues, and Browser Run for connpass.com
  admin automation; `apps/pay/` uses D1, R2, Gemini receipt extraction, and Google Sheets/Drive sync.
- `apps/website/` is the public GDG Japan React Router v7 SSR website on Cloudflare Workers. It uses a
  TinyURL service binding and has no D1 database.
- `apps/ost/` is the Open Space Technology support app (`ost.gdgs.jp`): per-event topic collection,
  participant voting, a venue desk-layout editor, projector screens, and auto-assignment of
  top-voted topics to desks. React Router v7 SSR on Cloudflare Workers. Public participant pages
  live at `/:slug`; all admin surfaces (dashboard, screens, editor) are `apps/accounts/` relying-party
  routes gated by GDG chapter membership. D1 (`DB`) holds only auth tables + an `events` registry;
  each event's live state (topics, votes, merge groups, desks) is one per-slug Durable Object
  (`OstBoard`, SQLite storage + hibernatable WebSockets, `getByName(slug)`).
- `apps/roster/` is the staff shift-schedule generator for events (`roster.gdgs.jp`): owners define
  time slots/tracks/roles/demand, staff self-register through a public link, and an auto-generator
  drafts a schedule (skill-mix aware) for hand-editing before publishing a read-only shared view.
  React Router v7 SSR on Cloudflare Workers, scaffolded from `apps/ost/` but feature-first from the
  start (`app/features/<domain>/`, no `app/lib/` grab-bag) — see `docs/roster/`. D1 (`DB`) holds
  auth tables; domain tables land starting Stage 02 of that plan. All admin surfaces are
  `apps/accounts/` relying-party routes gated by GDG chapter membership; staff self-registration and
  the published shift view are separate public/sign-in-only surfaces.
- `apps/mc/` is the remote MC audio player (`mc.gdgs.jp`): the operator controller (an
  `apps/accounts/` relying party gated by chapter membership) sends commands through a
  per-track `McRoom` Durable Object (one channel per track) to that track's OBS Browser Source
  player page (`/play?track=<id>&t=<token>`). Clip audio
  and timestamped transcripts are generated offline into `public/audio/` and `clips.json`
  (`scripts/build-clips.mjs`); the source `音声/` and `原稿/` folders are never committed.
  Clips added later from the controller are stored in R2 (`AUDIO`) + D1 (`uploaded_clip`).
- `apps/screen/` is the remote speaker feed for OBS (`screen.gdgs.jp`): speakers join a stage
  from a shared invite link (no login) and send camera, mic and screen share through the
  Cloudflare Realtime SFU; the operator control room (an `apps/accounts/` relying party gated by
  chapter membership) assigns speakers to output slots, talks back (push-to-talk while ON AIR),
  and sends cue cards; each slot's camera/screen/mic is a token-gated OBS Browser Source page
  (`/out/<stage>/<slot>/<kind>?t=<token>`). D1 holds auth tables + the stage registry; live state
  is one `StageRoom` Durable Object per stage. The SFU app secret is `REALTIME_APP_TOKEN`.
- `apps/deck/` is the in-house Stream Deck Mobile replacement for OBS (`deck.gdgs.jp`): chapter
  members edit a deck (pages, folders, keys running OBS actions, multi-actions) in the PC
  editor and press keys from a phone PWA (an `apps/accounts/` relying party, chapter-gated); an
  OBS custom browser dock (`/dock/<deck>?t=<token>`, no login) connects to the local
  obs-websocket v5 and to the deck's `DeckRoom` Durable Object, so phone and PC need no shared
  LAN. D1 holds auth tables + decks (layout JSON, versioned) + image rows; key images are in R2
  (`IMAGES`).
- `apps/roulette/` is the event prize lottery (`roulette.gdgs.jp`): organizers create a project
  and set up to 15 prizes with a stock each (unlimited = the losing slot) and a draw mode
  (standard: by what is left, custom: % per prize, or evil: chosen prizes never come out) on
  `/admin/<slug>` — an `apps/accounts/` relying party gated by chapter membership, which also
  shows the draw log (CSV download); visitors spin a roulette wheel once per device at the public
  `/<slug>`, which never shows stock or exclusions. Runs on the Workers Free plan: D1 only (no Durable Objects, KV,
  Queues or R2); each spin is one atomic D1 batch.
- `apps/pr/` is the event PR assistant (`pr.gdgs.jp`): one campaign per event (host chapter +
  co-host chapters), a versioned brief, a schedule of posts, mails, asks and derived reminders,
  runner-written drafts with review and approval, delivery through `SNS` / `TINYURL` / `CONNPASS`
  service bindings (`PrService` entrypoints, each approved by the account's own chapter), images
  from Playbook templates (Browser Rendering, R2 `IMAGES`, img.gdgs.jp via `IMG_UPLOAD`), metrics
  and ads CSVs, and a learning loop back into the Playbook. An `apps/accounts/` relying party gated
  by chapter membership; D1 plus a read-only `WIKI` binding for outreach contacts (the Wiki page is
  their source of truth). It never calls an LLM (the OCI runner, `gdg pr runner`, does). Its rules
  come from the `skills/pr-playbook` Playbook (gdg-jp/skills submodule), bundled at build time; see
  `docs/plans/pr/`.
- `apps/meet/` is the GDG Japan Google Meet manager (`meet.gdgs.jp`): chapter members create and
  manage Google Meet meetings on behalf of the shared `community-support@gdgoc.jp` account without
  sharing its password (co-hosts, participants, Calendar events, and automatic Drive sharing /
  Calendar attachment of meeting artifacts; see `docs/plans/meet/`). React Router v7 SSR on
  Cloudflare Workers and an `apps/accounts/` relying party; Stage 01 holds auth tables in D1 (`DB`)
  and the `ACCOUNTS` service binding, with `ACCOUNTS_DIRECTORY` RPC, Google OAuth/APIs, `MEET_JOBS`
  Queue, and Workspace Events / cron landing in Stages 02–06.
- `apps/agent/` is the knowledge-platform front door for Discord and Google Chat
  (`agent.gdgs.jp`, v2 Stage 05): a plain Cloudflare Worker (D1, KV, one `PendingSweeper`
  Durable Object, `WIKI` service binding) that verifies webhooks, links chat accounts to GDG
  Accounts, searches and reads the wiki **as the asker or the guild / Chat-space principal**,
  and queues `answer` jobs for the OCI runner. It never calls an LLM. It replaced the Vercel
  `apps/agents`.
- `apps/mcp/` is the GDG Japan MCP server (`mcp.gdgs.jp/mcp`, Streamable HTTP): a plain
  Cloudflare Worker that is the OAuth authorization server for MCP clients
  (`@cloudflare/workers-oauth-provider`: CIMD + DCR, consent page, KV `OAUTH_KV`) and signs
  people in through GDG Accounts as the trusted client `mcp`. Tools call other apps' existing
  Bearer APIs **as the signed-in person** with that Accounts token (today: the wiki, over the
  `WIKI` service binding). Scopes `wiki:read` / `wiki:write`. It never calls an LLM.
- `packages/gdg-lib/` is the source-only shared TypeScript package (`@gdgjp/gdg-lib`) for relying-party
  auth and signed-cookie helpers. Keep code app-local unless it is genuinely shared here.
- `packages/design-system/` is the `gdg-jp/design-system` Git submodule and shared React 19 workspace (`@gdgjp/design-system`).
  Initialize it with `git submodule update --init packages/design-system` before installing dependencies. It is independent of
  application routing, authentication, and data fetching. Its `DESIGN.md` `## Harness` section is
  the entrypoint for the design harness: contracts in `design/`, `pnpm --filter @gdgjp/design-system
  design:*` checks, the `gdg-design` MCP server, and the `design-build` / `design-review` /
  `design-improve` Skills.
- `apps/tinyurl-gateway/` is a Vercel Edge gateway for TinyURL custom domains.
- `apps/go-extension/` is a Manifest V3 Chrome extension.
- `apps/accounts-oidc-client-demo/` is a standalone Cloudflare Worker demonstrating an OIDC relying
  party; it does not use D1, KV, or service bindings.

`apps/cli/` contains the Go-based `gdg` CLI and is not a pnpm workspace. `apps/learn/` is a Git submodule. `infra/oci-runner/` deploys the knowledge runner (`gdg wiki runner`) on an OCI VM. Repository automation lives
in `scripts/`; supporting documentation lives in `docs/`.
