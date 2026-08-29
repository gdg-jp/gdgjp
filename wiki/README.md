# @gdgjp/wiki

Community wiki for GDG Japan, deployed at wiki.gdgs.jp on Cloudflare Workers. It is the most
feature-rich package in the monorepo: D1, R2, Queues, Browser Rendering, Workers AI, Vectorize,
and a Durable Object pair power realtime collaborative editing, AI-assisted page generation from
uploaded documents/URLs/Google Drive, semantic search, and multi-source ingestion (Google Docs,
Google Chat, Discord, websites). It is an OAuth relying party of `accounts/` and the only app in
the repo with a Git-based CLI workflow (`gdg wiki clone`; see the root README's "Wiki through
Git" section) and a bounded `/api/agent/*` read surface consumed by the separate `agents-index/`
local MCP service and by `agents/` / `agents-local/` for LLM-driven wiki editing.

Full package conventions and architecture notes live in `CLAUDE.md`; this file is the onboarding
summary.

## Tech stack and bindings

React Router v7 SSR on Cloudflare Workers, Drizzle ORM over D1 (wiki is the only app on Drizzle;
every other app uses Kysely), TipTap + Yjs for realtime collaborative editing, the Vercel AI SDK
(`@ai-sdk/google`) for Gemini-backed generation, and `agents` (Cloudflare Agents SDK) for the
multi-phase wiki-generation workflow.

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | Primary store, via Drizzle (`getDb(env)` in `app/lib/db.server.ts`). Schema in `app/db/schema/`. |
| `BUCKET` | R2 | Page attachments and ingestion uploads (bucket `gdgjp-wiki-storage`). |
| `TRANSLATION_QUEUE` | Queue | JA→EN auto-translation jobs (producer + consumer). |
| `GOOGLE_DOCUMENT_IMPORT_QUEUE` | Queue | Google Docs import jobs (long-running; outlives the browser request). |
| `SOURCE_FETCH_QUEUE` | Queue | Source-fetch start messages; the import itself continues via DO alarms, not the queue. |
| `BROWSER` | Browser Rendering | Headless Chromium for PDF export. |
| `AI` | Workers AI | `bge-m3` embeddings (1024-dim) for semantic page search. |
| `VECTORIZE` | Vectorize | Index `gdgjp-wiki-pages`, cosine metric, 1024 dims. |
| `WIKI_AI_TELEMETRY` | Analytics Engine | AI generation model-call metrics (`wiki_ai_model_calls`). |
| `COLLAB_DO` | Durable Object | `CollabDurableObject` — one instance per page slug (`idFromName(slug)`); Yjs CRDT over WebSocket at `/ws/collab/:slug`. |
| `SOURCE_IMPORT_DO` | Durable Object | `SourceImportDurableObject` — one instance per source (`getByName(sourceId)`); alarm self-chain drives resumable import phases for Chat, Drive, Discord, and website sources. |
| `WikiGenerationAgent` | Durable Object (Agents SDK) | Runtime adapter for the ingestion RPC/state/realtime-broadcast surface at `/agents/wiki-generation-agent/:sessionId`. |
| `GENERATION_WORKFLOW` | Workflow | `WikiGenerationPhaseWorkflow` — a fresh instance per user checkpoint in the generation flow. |
| `ACCOUNTS` | Service binding | Worker-to-worker OIDC discovery/token/userinfo against `accounts/` (remote-bound, so `wrangler dev` needs no local `accounts` process). |
| `ASSETS` | Assets | Static client build output. |

Both `CollabDurableObject` and `SourceImportDurableObject` are re-exported from `workers/app.ts` so
Wrangler registers them; the Worker's single `ExportedHandler<Env>` has three entry points —
`fetch` (routes `/agents/*` and `/ws/collab/*`, else React Router), `scheduled` (two crons: task
Discord reminders at 00:00 JST, and daily/weekly source refresh enqueue), and `queue` (consumes
all three producers above).

## Directory structure

See `ARCHITECTURE.md`. Code locations and placement rules live there as the source of truth.

## Local dev setup

Copy `.dev.vars.example` to `.dev.vars`. Required:

- `RP_SESSION_SECRET` — HMAC key for the RP's signed session + OIDC transaction cookies (generate
  with `openssl rand -base64 48`).
- `IDP_CLIENT_SECRET` — OAuth client secret shared with the `accounts/` IdP (must match
  `WIKI_CLIENT_SECRET` on `accounts/`; reseed via `/admin/seed-clients` on `accounts/` if it
  changes, per the repo root `CLAUDE.md`).

Also set in `.dev.vars.example`, pre-filled to point local dev at a local `accounts` process:
`APP_URL`, `ACCOUNTS_URL`, `IDP_URL` (wiki's dev server runs on port 5177, separate from
`accounts` on 5173).

Optional, feature-gated:

- `GEMINI_API_KEY` — AI ingestion/translation/generation features.
- `AI_GATEWAY_BASE_URL` / `AI_GATEWAY_TOKEN` — AI generation observability via Cloudflare AI
  Gateway; leave both empty locally to fall back to direct Gemini calls.
- `GOOGLE_DOCS_CLIENT_ID` / `GOOGLE_DOCS_CLIENT_SECRET` / `GOOGLE_PICKER_API_KEY` /
  `GOOGLE_CLOUD_PROJECT_NUMBER` — Google Drive/Docs direct import (Picker key must be restricted
  to the local/prod origins and the Picker API).
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` / `WIKI_DISCORD_SECRET` —
  Discord OAuth guild picker and channel-history import under `/sources`, plus task due-date
  reminders.

Production-only secrets set with `wrangler secret put` (see the comment block at the end of
`wrangler.toml`) additionally include `RESEND_API_KEY` and `FCM_SERVICE_ACCOUNT_JSON`.

## Scripts

Run from the repo root with `pnpm --filter @gdgjp/wiki <script>`, or from `wiki/` directly:

| Script | Purpose |
|---|---|
| `dev` | `react-router dev` — dev server on port 5177. |
| `build` | `react-router build`. |
| `deploy` | `wrangler deploy`. |
| `typecheck` | `wrangler types && react-router typegen && tsc --noEmit`. Re-run (or `cf-typegen`) after any `wrangler.toml` binding edit. |
| `cf-typegen` | `wrangler types` only. |
| `test` | `vitest run` (unit + golden). |
| `test:golden` | `vitest run tests/golden` — TipTap↔Markdown conversion/rendering snapshots. |
| `test:golden:update` | Refresh golden snapshots (`-u`); review the diff when the editor schema changes. |
| `test:coverage` | `vitest run --coverage`. |
| `test:e2e` | `playwright test`; auto-boots the dev server on 5177. |
| `migrate:local` | Applies migrations to the local D1 (`gdgjp-wiki-db`) and regenerates `schema.sql`. |
| `migrate:remote` | Same, against the remote D1. |
| `openapi:lint` / `openapi:bundle` / `openapi:generate` | Lint, bundle, and generate types for `openapi/openapi.yaml` (the CLI-facing API surface). |

## Testing notes

- E2E bypasses the IdP entirely: `tests/e2e/global-setup.ts` seeds three fixed users
  (`admin`/`author`/`member`) plus a stable test page directly into the local miniflare D1 sqlite
  file, and forges a `gdgjp-wiki-session` cookie signed with `RP_SESSION_SECRET` from `.dev.vars`.
  It requires `pnpm dev` to have already created the local D1 state. `tests/e2e/fixtures.ts`
  exposes `adminPage` / `authorPage` / `memberPage`; the cookie format and the session-secret env
  var must change together across both files.
- Golden tests snapshot the canonical-Markdown storage model against TipTap's editor
  representation — page and version content is stored as Markdown, and `tiptap-convert.ts` is only
  a legacy TipTap JSON → Markdown boundary converter.
- Queue messages are discriminated by type guards in `queue-processors.server.ts`; the Worker
  drops unrecognized messages via `ack()` rather than retrying them.
