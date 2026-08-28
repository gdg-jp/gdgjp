# OST (`ost.gdgs.jp`)

Open Space Technology support app: per-event topic collection, participant voting, a venue
desk-layout editor, projector screens, and auto-assignment of top-voted topics to desks.

## Routes (`app/routes.ts`, config mode)

- `/` — dashboard: list + create events. **Auth + chapter required.**
- `/:slug` — participant page: submit a topic + 投票する dialog. **Public.** Sets an anonymous
  `ost-voter` cookie for one-vote-per-topic dedup (toggle; retractable).
- `/:slug/screen` — projector: topic cards, drag one onto another to merge, tap a stack to
  spread it over a black backdrop. **Auth + chapter required** (every viewer can edit).
- `/:slug/tables` — projector: each desk with its assigned topic(s). **Auth + chapter.**
- `/:slug/edit` — desk layout editor (add / drag / resize / rotate), auto-assign, topic admin.
  **Auth + chapter.**
- `/signin`, `/api/auth/*`, `/auth/signout` — gdg-lib relying-party plumbing (`cookiePrefix
  gdgjp-ost`, `ACCOUNTS` service binding).
- `/no-chapter` — shown when the user has no GDG chapter.
- `/dev/login`, `/dev/seed` — local/e2e only; **hard 404 when `ENVIRONMENT === "production"`.**

Static routes outrank `/:slug`; `slug.ts` also rejects reserved words / bad shapes in every
`:slug` loader.

## Data

- **D1 (`DB`)** — `user` + `oidc_session` (gdg-lib) and an `events` registry
  (`slug`, `title`, `chapter_id`, `chapter_slug`). Migrations in `migrations/`; `schema.sql` is
  generated (`pnpm migrate:local`).
- **Per-event Durable Object** — `OstBoard`, addressed `env.OST_BOARD.getByName(slug)`. Own
  SQLite: `topics` (+`group_id`,`desk_id`), `votes` (PK `topic_id,voter_id`), `groups`, `desks`.
  Schema in `workers/ost-board-schema.ts` (idempotent `CREATE TABLE IF NOT EXISTS`; no
  `PRAGMA user_version` — Workers SQLite rejects it via `sql.exec`). FK cascades are done in RPC
  code, not by SQLite.

## Realtime

`OstBoard` broadcasts one full `{ type: "state", state: OstBoardState }` snapshot on every
mutation (payload is small; avoids granular-delta reducers). Clients connect
`/ws?board=<slug>`; `workers/app.ts` parses the slug and forwards the upgrade. `useLiveBoard`
seeds from the SSR loader then replaces state per frame, with exponential-backoff reconnect.
The participant vote dialog connects only while open.

## Auth / chapter ACL

`lib/auth.server.ts` (`getAuth`), `lib/chapter.server.ts` (`fetchChaptersForUser`, 30 s cache
over `getFreshClaims`; **dev hook**: reads an `ost-dev-chapters` cookie when
`ENVIRONMENT !== "production"`), `lib/auth-redirect.server.ts`
(`requireUserWithChapter`, `requireEventAccess`). An event belongs to one chapter; any member of
that chapter may view and edit it.

## Pure helpers (unit-tested, `app/lib/*.test.ts`)

`topics.ts` (`normalizeTopicText`), `slug.ts`, `votes.ts`, `scoring.ts` (`buildUnits`,
`scoreUnit` = **sum** of member votes), `assign.ts` (`rankUnits` = votes desc then earliest
submission, `autoAssign` zips onto desks by `sortOrder`), `layout.ts` (desk geometry, contain-fit
transform). DO classes are not unit-tested — cover via `e2e/`.

## Config

Vite: `resolve.dedupe` + `optimizeDeps.include` for react / radix-ui / motion / lucide are
load-bearing — without them `@gdgjp/gdg-lib` (consumed as source) leaves the client with two
React copies ("invalid hook call" at hydration). `esbuild.keepNames` keeps the `OstBoard` class
name for the wrangler migration.

`.dev.vars` needs `RP_SESSION_SECRET`, `IDP_CLIENT_SECRET` (= the accounts worker's
`OST_CLIENT_SECRET`), and `APP_URL=http://localhost:5185`. Register the `ost` OIDC client on the
accounts side (`accounts/wrangler.toml` vars + `seed-clients.server.ts` tuple, then
`POST /admin/seed-clients`).

Local: `pnpm --filter @gdgjp/ost migrate:local` then `pnpm --filter @gdgjp/ost dev` (port
`5185`); run `accounts` on `5173` for real sign-in, or use `/dev/login?as=owner&chapter=1:x`.
