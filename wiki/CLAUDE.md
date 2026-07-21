# CLAUDE.md — `@gdgjp/wiki`

wiki.gdgs.jp. Repo-wide conventions in `../CLAUDE.md`.

## Dev

```
pnpm --filter @gdgjp/wiki dev                  # :5177
pnpm --filter @gdgjp/wiki test                 # vitest (unit + golden)
pnpm --filter @gdgjp/wiki test:golden          # golden snapshots only
pnpm --filter @gdgjp/wiki test:golden:update   # refresh snapshots
pnpm --filter @gdgjp/wiki test:e2e             # playwright (auto-boots dev :5177)
pnpm --filter @gdgjp/wiki migrate:local        # also regenerates schema.sql
```

Re-run `cf-typegen` (or `typecheck`) after `wrangler.toml` binding edits.

## Worker entry — THREE handlers (`workers/app.ts`)

Single `ExportedHandler<Env>` — understand all three before touching:

- `fetch` — authenticates `/agents/wiki-generation-agent/:session` and routes it through the Agents SDK; short-circuits `/ws/collab/:slug` to `COLLAB_DO`; otherwise → RR.
- `scheduled` — cron `0 15 * * *` (15:00 UTC = 00:00 JST). Calls `sendDueTaskReminders(env)` to DM users whose task due-date is today JST.
- `queue` — consumes `TRANSLATION_QUEUE`. Wiki generation runs in the durable Agent Workflow instead of a Queue.

`CollabDurableObject` (Yjs/WebSocket; awareness via `y-protocols`) re-exported from same file so wrangler registers it.

## Bindings (env shape)

| Binding | Purpose |
|---|---|
| `DB` | D1, primary store. Via Drizzle (`getDb(env)` in `app/lib/db.server.ts`). |
| `BUCKET` | R2 — page attachments + ingestion uploads. |
| `TRANSLATION_QUEUE` | Translation producer+consumer; `app/lib/queue-processors.server.ts`. |
| `BROWSER` | Browser Rendering, headless Chromium for PDF. |
| `AI` | Workers AI; `bge-m3` for 1024-dim embeddings. |
| `VECTORIZE` | Index `gdgjp-wiki-pages`, cosine, 1024 dims — semantic page search. |
| `COLLAB_DO` | `CollabDurableObject`; one instance per page slug (`idFromName(slug)`). |
| `WikiGenerationAgent` / `GENERATION_WORKFLOW` | Durable Wiki generation state and workflow. The Agent binding name must match the exported class for automatic `/agents/*` routing. |

`worker-configuration.d.ts` is generated — don't hand-edit. Access via `context.cloudflare.env`.

## Auth — RP

OAuth **client** of accounts.gdgs.jp. No local password / better-auth (migrations `0021_drop_better_auth.sql`, `0022_simplify_user.sql`). `app/lib/auth.server.ts` → `initializeRpAuth`:

- `cookiePrefix: "gdgjp-wiki"` → session cookie `gdgjp-wiki-session`
- `RP_SESSION_SECRET` + `IDP_CLIENT_ID=wiki` + `IDP_CLIENT_SECRET`

`user` row populated from `/userinfo` at sign-in; `is_admin` is value **at last sign-in** — for fresh authz checks use `getFreshClaims()`. Wiki-specific fields (UI/content language, Discord ID) live on `user_preferences` so `user` stays uniform across RPs.

## Drizzle (not Kysely)

Wiki is the only app on Drizzle. Schema in `app/db/schema.ts`, `drizzle.config.ts` writes to `migrations/`. Migrations are **hand-written SQL** (not generated). `schema.sql` is the generated post-migration dump — edit migrations, not the dump.

## Wiki generation

Agents SDK multi-phase flow: user-uploaded docs / URLs / Google Drive → wiki pages via the configured AI SDK model.

- `WikiGenerationAgent` owns session synchronization/RPCs and `WikiGenerationWorkflow` owns durable execution and approval waits.
- `app/features/ingestion/wiki-workspace.server.ts` exposes bounded, permission-aware `ls/cd/pwd/cat/find/grep`; generation never uses Vectorize.
- `/ingest/:sessionId` synchronizes lightweight state with `useAgent()` and revalidates D1-backed drafts on revision changes.
- AI search remains independent under `app/features/ai-search/` and continues to use Workers AI + Vectorize.

## Realtime collab editor

TipTap on client, Yjs CRDT over WebSocket to `COLLAB_DO`. Awareness via `PresenceAvatars.tsx` + `remote-cursors-extension.ts`. `tiptap-convert.ts` round-trips TipTap JSON ↔ storage. Golden suite (`tests/golden/tiptap-*.test.tsx`) snapshots both directions — when editor schema changes, run `test:golden:update` and review diff.

## i18n

UI strings: `app/locales/{ja,en}/*.json` via `remix-i18next` (`i18n.server.ts` / `i18n.ts`). Two independent axes — **UI** language (`/api/set-ui-lang`) and **content** language (`/api/set-content-lang`); both persist on `user_preferences`. Default `ja`.

## E2E setup (no real OAuth)

`tests/e2e/global-setup.ts` bypasses the IdP entirely:

1. Locates miniflare D1 sqlite under `.wrangler/state/v3/d1/...` (fails with a hint if `pnpm dev` hasn't created it).
2. Inserts three fixed users (`admin`/`author`/`member`) + a stable test page, forges a `gdgjp-wiki-session` cookie signed with `RP_SESSION_SECRET` from `.dev.vars`.
3. Writes storage-state files under `tests/e2e/storage-state/{admin,author,member}.json`.

`tests/e2e/fixtures.ts` exposes `adminPage` / `authorPage` / `memberPage`. When changing cookie format or session-secret env var, both files MUST move together.

## App conventions

- `~/*` → `./app/*`.
- `.server.ts` modules are server-only (enforced by Vite's import boundary) — never import from client code.
- Cron set up for ONE trigger; adding another → update `[triggers].crons` + the `scheduled` handler discriminator together.
- Translation Queue messages MUST be discriminable by the guard in `queue-processors.server.ts`. Worker drops unrecognized messages via `ack()`.
