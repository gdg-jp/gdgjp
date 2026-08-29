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
- `scheduled` — two crons: `0 15 * * *` (task Discord reminders, 00:00 JST) and `0 16 * * *` (daily/weekly source refresh enqueue).
- `queue` — consumes `TRANSLATION_QUEUE`, Google Docs import jobs, and `SOURCE_FETCH_QUEUE`. Source import continuation for Chat, Drive, Discord, and websites runs in `SOURCE_IMPORT_DO` alarms, not the queue.

`CollabDurableObject` and `SourceImportDurableObject` are re-exported from the same file so wrangler registers them.

## Bindings (env shape)

| Binding | Purpose |
|---|---|
| `DB` | D1, primary store. Via Drizzle (`getDb(env)` in `app/lib/db.server.ts`). |
| `BUCKET` | R2 — page attachments + ingestion uploads. |
| `TRANSLATION_QUEUE` | Translation producer+consumer; `app/lib/queue-processors.server.ts`. |
| `SOURCE_FETCH_QUEUE` | Source fetch start messages (`source_fetch`). Source import work continues via DO alarms. |
| `BROWSER` | Browser Rendering, headless Chromium for PDF. |
| `AI` | Workers AI; `bge-m3` for 1024-dim embeddings. |
| `VECTORIZE` | Index `gdgjp-wiki-pages`, cosine, 1024 dims — semantic page search. |
| `COLLAB_DO` | `CollabDurableObject`; one instance per page slug (`idFromName(slug)`). |
| `SOURCE_IMPORT_DO` | `SourceImportDurableObject`; one instance per source (`getByName(sourceId)`). Alarm self-chain drives each driver's resumable phases. |
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

- `WikiGenerationAgent` is a runtime adapter for RPC, coarse state projection, Workflow tracking,
  and realtime broadcasts. Each user checkpoint starts a separate
  `WikiGenerationPhaseWorkflow` instance.
- Business logic lives under `workers/features/ingestion/`, split into orchestration, model,
  tools, and persistence. The bounded, permission-aware Wiki workspace exposes
  `ls/cat/search`; generation never uses Vectorize.
- `/ingest/:sessionId` consumes display-safe realtime events through `useAgent()` while D1-backed
  loaders remain authoritative and provide the reconnect fallback.
- AI search remains independent under `app/features/ai-search/` and continues to use Workers AI + Vectorize.

## Realtime collab editor

TipTap on client, Yjs CRDT over WebSocket to `COLLAB_DO`. Awareness via `PresenceAvatars.tsx` + `remote-cursors-extension.ts`. Page and version storage is canonical Markdown; `tiptap-convert.ts` is only a legacy TipTap JSON → Markdown boundary converter. Golden suite (`tests/golden/tiptap-*.test.tsx`) snapshots conversion and rendering — when editor schema changes, run `test:golden:update` and review diff.

## i18n

UI strings: `app/locales/{ja,en}/*.json` via `remix-i18next` (`i18n.server.ts` / `i18n.ts`). Two independent axes — **UI** language (`/api/set-ui-lang`) and **content** language (`/api/set-content-lang`); both persist on `user_preferences`. Default `ja`.

## E2E setup (no real OAuth)

`tests/e2e/global-setup.ts` bypasses the IdP entirely:

1. Locates miniflare D1 sqlite under `.wrangler/state/v3/d1/...` (fails with a hint if `pnpm dev` hasn't created it).
2. Inserts three fixed users (`admin`/`author`/`member`) + a stable test page, forges a `gdgjp-wiki-session` cookie signed with `RP_SESSION_SECRET` from `.dev.vars`.
3. Writes storage-state files under `tests/e2e/storage-state/{admin,author,member}.json`.

`tests/e2e/fixtures.ts` exposes `adminPage` / `authorPage` / `memberPage`. When changing cookie format or session-secret env var, both files MUST move together.

## Code map — 「X はどこ？」

Details in `ARCHITECTURE.md`. Scan this table to narrow the location before you grep.

| 探しもの | 場所 |
|---|---|
| ページ本体 / ACL / 可視性 / ツリー / バージョン | `app/lib/page-*.server.ts`, `app/lib/acl-spans*` |
| ソース取り込み（UI・API 側） | `app/lib/sources.server.ts`, `app/routes/sources.tsx`, `app/routes/api.sources.*` |
| ソース取り込み（Worker 実行・DO alarm・refresh cron） | `workers/features/sources/` |
| wiki 生成 AI（Agents SDK / Workflow） | `workers/features/ingestion/` — README あり |
| wiki 生成 AI（クライアント配線 / ingest 画面） | `app/features/ingestion/`, `app/routes/ingest*.tsx` |
| AI 検索（Workers AI + Vectorize） | `app/features/ai-search/` |
| Google 連携（Drive / Docs / Forms / Chat） | `app/lib/google-*.server.ts`, `app/features/google-documents/` |
| Discord 連携 | `app/lib/discord-*.server.ts` |
| CLI / エージェント読み取り API | `app/routes/api.cli.wiki.*`, `app/routes/api.agent.*` |
| リアルタイム共同編集 | `workers/collab-durable-object.ts`, `app/hooks/useCollabEditor.ts` |
| DB スキーマ | `app/db/schema.ts` |

**読まないファイル**（生成物、grep のノイズ）: `worker-configuration.d.ts`（14,750 行、正本は
`wrangler.toml` の表）・`schema.sql`（599、正本 `app/db/schema.ts`）・`openapi/types.generated.ts`
（1,157、正本 `openapi/openapi.yaml`）。

このマップはファイルを移動したら同じ変更内で更新する契約。全ドメイン分は `ARCHITECTURE.md`。

## App conventions

- `~/*` → `./app/*`.
- `.server.ts` modules are server-only (enforced by Vite's import boundary) — never import from client code.
- Cron triggers are listed in `[triggers].crons`; the `scheduled` handler discriminates by cron string (`TASK_REMINDER_CRON` / `SOURCE_REFRESH_CRON`). Adding another → update both together.
- Queue messages MUST be discriminable by the guards in `queue-processors.server.ts`. Worker drops unrecognized messages via `ack()`.
