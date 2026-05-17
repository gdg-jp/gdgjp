# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Wiki-specific guidance. Repo-wide conventions (workspace layout, Biome rules, Conventional Commits) live in `../CLAUDE.md` — read both.

## Commands

From the repo root, scope with `--filter @gdgjp/wiki`:

```
pnpm --filter @gdgjp/wiki dev            # vite + cloudflare plugin, port 5177
pnpm --filter @gdgjp/wiki test           # vitest (unit + golden)
pnpm --filter @gdgjp/wiki test:golden    # only golden snapshot tests
pnpm --filter @gdgjp/wiki test:golden:update  # refresh snapshots
pnpm --filter @gdgjp/wiki test:e2e       # playwright (auto-boots dev on :5177)
pnpm --filter @gdgjp/wiki typecheck      # wrangler types + react-router typegen + tsc
pnpm --filter @gdgjp/wiki migrate:local  # apply D1 migrations + regenerate schema.sql
```

Single Vitest file: `pnpm --filter @gdgjp/wiki exec vitest run app/lib/foo.test.ts`.
Single Playwright spec: `pnpm --filter @gdgjp/wiki exec playwright test access-control.spec.ts`.

After editing `wrangler.toml` bindings, rerun `pnpm --filter @gdgjp/wiki cf-typegen` so `worker-configuration.d.ts` (the global `Env` type) reflects the new shape.

## Worker entry — multiple handlers

`workers/app.ts` exports a single `ExportedHandler<Env>` with **three** entry points; understand all of them before touching it:

- `fetch` — short-circuits WebSocket upgrades on `/ws/collab/:slug` to the `COLLAB_DO` Durable Object (configured via `run_worker_first = ["/ws/*"]` in `wrangler.toml`), otherwise delegates to React Router via `createRequestHandler`.
- `scheduled` — cron `0 15 * * *` (15:00 UTC = 00:00 JST start-of-day). Calls `sendDueTaskReminders(env)` to DM users whose task due-date matches the current JST date.
- `queue` — consumes both `TRANSLATION_QUEUE` and `INGESTION_QUEUE`. Discriminates messages with `isTranslationQueueBody` / `isIngestionQueueMessage` type-guards. On failure of an ingestion job it best-effort marks `ingestionSessions.status = "error"` so the UI stops spinning, then calls `message.retry()`.

`CollabDurableObject` (Yjs over WebSocket, awareness via `y-protocols`) is re-exported from the same file so wrangler registers the class.

## Cloudflare bindings (env shape)

Defined in `wrangler.toml`; the matching TS types are generated into `worker-configuration.d.ts` (don't hand-edit). Access via `context.cloudflare.env` in loaders/actions.

| Binding | Purpose |
| --- | --- |
| `DB` | D1, primary store. Accessed through Drizzle (`getDb(env)` in `app/lib/db.server.ts`). |
| `BUCKET` | R2, page attachments + ingestion uploads. |
| `TRANSLATION_QUEUE` / `INGESTION_QUEUE` | Producer+consumer; processed by `app/lib/queue-processors.server.ts`. |
| `BROWSER` | Cloudflare Browser Rendering, headless Chromium for PDF generation. |
| `AI` | Workers AI; runs `bge-m3` for 1024-dim embeddings. |
| `VECTORIZE` | Index `gdgjp-wiki-pages`, cosine, 1024 dims — semantic page search. |
| `COLLAB_DO` | Durable Object class `CollabDurableObject`; one instance per page slug (`idFromName(slug)`). |

## Auth — RP, not IdP

Wiki is an OAuth **client** of `accounts.gdgs.jp`. There is no local password / better-auth here anymore (see migration `0021_drop_better_auth.sql` and `0022_simplify_user.sql`). `app/lib/auth.server.ts` calls `initializeRpAuth` from `@gdgjp/gdg-lib` with:

- `cookiePrefix: "gdgjp-wiki"` — session cookie is `gdgjp-wiki-session`.
- `RP_SESSION_SECRET` (HMAC) + `IDP_CLIENT_ID=wiki` + `IDP_CLIENT_SECRET` secret.

The `user` row is populated from the IdP `/userinfo` response at sign-in; `is_admin` reflects the value **at last sign-in** — for fresh authorization checks use `getFreshClaims()`. Wiki-specific user fields (UI/content language, Discord ID) live in `user_preferences`, split out so the `user` table stays uniform across all RPs.

## Drizzle, not Kysely

Wiki is the only app that uses Drizzle (the rest use Kysely via `gdg-lib`). Schema in `app/db/schema.ts`, `drizzle.config.ts` writes to `migrations/`. Migrations are hand-edited SQL (not generated) — `schema.sql` is a **generated** post-migration dump produced by `../scripts/dump-schema.sh`; edit migrations, not the dump.

## Ingestion pipeline

Long-running, multi-phase, queue-driven flow that converts user-uploaded docs / URLs / Google Drive content into wiki pages via Gemini.

- HTTP routes `app/routes/api.ingest.$sessionId.*.ts` enqueue work onto `INGESTION_QUEUE` and serve status to the UI.
- The queue handler dispatches to `app/lib/ingestion-pipeline/run-phases.ts` (orchestration) and `run-preprocess.ts`. Prompts/schemas/parts for Gemini live under `app/lib/gemini/`.
- Phase progress is written back to `ingestion_sessions.phaseMessage` so the polling UI (`/ingest/:sessionId`) can show what stage it's on.
- On embedding writes the pipeline goes through `app/lib/embedding-pipeline.server.ts` → Workers AI → `VECTORIZE`. The `vectorize_embedding_status` column (migration 0013) tracks per-page sync state.

## Realtime collab editor

TipTap (`@tiptap/*`) on the client, Yjs CRDT over WebSocket to `COLLAB_DO`. Awareness/presence is rendered by `PresenceAvatars.tsx` + `remote-cursors-extension.ts`. `tiptap-convert.ts` round-trips between TipTap JSON and the storage representation; the golden suite (`tests/golden/tiptap-*.test.tsx`) snapshots both directions — when the editor schema changes, run `test:golden:update` and review the diff.

## i18n

UI strings: `app/locales/{ja,en}/*.json`, loaded via `remix-i18next` (`i18n.server.ts` / `i18n.ts`). Two independent language axes: **UI** language (`/api/set-ui-lang`) and **content** language preference (`/api/set-content-lang`); both persist on `user_preferences`. Default is `ja`.

## E2E test setup (no real OAuth)

`tests/e2e/global-setup.ts` bypasses the IdP entirely:

1. Locates the miniflare D1 sqlite under `.wrangler/state/v3/d1/...` (fails with a hint if `pnpm dev` hasn't run yet to create it).
2. Inserts three fixed users (`admin` / `author` / `member`) and a stable test page, then forges a `gdgjp-wiki-session` cookie signed with `RP_SESSION_SECRET` from `.dev.vars`.
3. Writes per-role storage-state files under `tests/e2e/storage-state/{admin,author,member}.json`.

`tests/e2e/fixtures.ts` exposes `adminPage` / `authorPage` / `memberPage` fixtures that load those storage states. When changing auth cookie format or the session-secret env var, both files must move together.

## Conventions specific to this app

- The `~/*` alias maps to `./app/*` (per `tsconfig.json`).
- Server-only modules end with `.server.ts` (enforced by Vite's import boundary) — never import these from client code or browser bundles will explode at build time.
- Cron is set up for **one** trigger; if you add another, update `[triggers].crons` and the `scheduled` handler discriminator together.
- Queue messages must be discriminable by the type-guards in `queue-processors.server.ts` / `ingestion-jobs.server.ts`. When adding a new message shape, extend a guard — the worker drops unrecognized messages with `ack()` (no retry).
