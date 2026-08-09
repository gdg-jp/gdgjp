# Stage 2 — Google Chat ingestion

## Context — Background and repository state

Bring the Google Chat history where operational discussions actually occur into raw storage.

Google Docs preserve only decisions, while Chat retains decision context such as “why we chose that venue” and “which catering had leftovers.” The latter is needed for AI to support event operations.

The overall strategy is in `docs/plans/00-llm-wiki-overview.md`.

**Dependencies:** Stage 1 (the `sources` / `source_documents` / `source_assets` tables and `SOURCE_FETCH_QUEUE` must exist)
**Workspace in scope:** `wiki/` only

### Prerequisite verification (the first task of this stage)

The Google Chat API supports user authentication with `spaces.messages.list`, readable with:

`https://www.googleapis.com/auth/chat.messages.readonly`

Workspace administrator permissions (Vault / Admin SDK) are not required. The user reads Spaces they participate in using their own authorization.

However, the Google Cloud project requires the following:

- Enable the Google Chat API.
- Configure a Chat app (configuration is required even when using user authentication only).

**Verify connectivity before implementation.** Confirm that user tokens can access `GET https://chat.googleapis.com/v1/spaces` and `GET https://chat.googleapis.com/v1/spaces/{space}/messages` before proceeding.
If they cannot, stop implementation and report it. The fallback is to ingest a manual export (Google Takeout Chat JSON) as `kind: upload` raw content, but that requires a separate decision.

### Required reading

- `wiki/CLAUDE.md` — bindings and conventions
- `docs/plans/01-sources-raw-layer.md` — the Stage 1 data model and fetch-worker architecture

### Existing implementation to reuse

- `wiki/app/lib/google-drive.server.ts` — OAuth URL creation, token exchange, and refresh. Chat shares this token foundation.
- `wiki/app/routes/api.google-drive.auth.ts` / `api.google-drive.callback.ts` — authorization flow
- Stage 1 `wiki/workers/features/sources/{fetch-source,persist}.ts` — dispatcher and finalization flow

## Design

### 1. Expand OAuth scopes

Add these scopes to `getGoogleDriveAuthUrl` in `wiki/app/lib/google-drive.server.ts`.

```
https://www.googleapis.com/auth/chat.spaces.readonly
https://www.googleapis.com/auth/chat.messages.readonly
```

Tokens of already linked users do not contain these scopes, so renewed consent is required. **Do not let this fail silently.**

- Add a nullable, space-delimited `granted_scopes` column to `google_drive_tokens`.
- Save the token-exchange response’s `scope`.
- Immediately before fetching Chat, verify the required scopes. If they are absent, set `sources.status` to `error`, put a reauthorization message in `error_message`, and direct the user to reauthorize from `/sources`.

### 2. Space selection

Do not automatically ingest every Space. Operations chooses the target Spaces.

- `GET /api/google-chat/spaces` — paginate `spaces.list` and return the Spaces the user participates in.
- Add a Space-selection UI to `/sources`. Register the selected Space as a source with `kind: google-chat-space` and `external_id: spaces/XXXX`.

### 3. Fetching and normalization

Create `wiki/workers/features/sources/google-chat.ts` (normalization + Google API helpers) and
`wiki/workers/features/sources/google-chat-import.ts` (Durable Object phase steps). Wire start
through `fetch-source.ts` → `SOURCE_FETCH_QUEUE` once, then continue in `CHAT_IMPORT_DO`.

- Paginate `GET https://chat.googleapis.com/v1/spaces/{space}/messages` with `pageSize=1000`.
  Each page is stored as one R2 object under `raw/<sourceId>/chat-runs/<runId>/pages/`.
- Resolve senders with `spaces.members.list`, then `people:batchGet` (≤200 / request) for the rest.
- Download attachments in parallel (≤4) into `source_assets`; skip 403/404 and >10 MB with a warning.
- Group messages into monthly R2 blobs, then `normalizeChatMessages` + `persistSourceDocument` per month.
- Continuations use Durable Object `alarm()` self-chains with a soft subrequest budget of 40 per tick.
  Queue messages are only the initial `source_fetch` start.

### 4. Incremental fetching

Store the last fetched message’s `createTime` for each month in `source_documents.cursor` (the column is added in Stage 1).

On refetch, set `google_chat_import_runs.since_cursor` to the max existing cursor and call
`messages.list` with `filter=createTime > "<cursor>"`. Append to existing monthly Markdown with
`assetPolicy: "merge"`. Untouched months keep their hashes; no R2 rewrite.

Reuse the Stage 1 `refresh_policy` cron unchanged.

### Constraints

- Do not change workspaces outside `wiki/`.
- Do not break table definitions created in Stage 1. Adding columns is allowed; changing the meaning of existing columns is not.
- `wiki/schema.sql` and `wiki/worker-configuration.d.ts` are generated. Do not edit them manually.
- Write migrations in handwritten SQL.
- Do not log Chat message bodies (they can contain sensitive information).
- Follow Biome, use `import type`, and preserve `.server.ts` boundaries.
- Do not add dependencies (do not modify `pnpm-lock.yaml`).
- Google Cloud Console configuration is out of implementation scope. Document the instructions in `docs/google-chat-setup.md`.

## Files to touch

- `wiki/app/lib/google-drive.server.ts` (scopes)
- `wiki/app/db/schema.ts`, `wiki/migrations/00XX_add_granted_scopes.sql`
- `wiki/app/routes/api.google-drive.callback.ts` (save `scope`)
- `wiki/app/routes/api.google-chat.spaces.ts` (new)
- `wiki/app/routes.ts`
- `wiki/app/routes/sources.tsx` (Space-selection UI)
- `wiki/workers/features/sources/google-chat.ts` (helpers), `google-chat-import.ts` (phases),
  `wiki/workers/google-chat-import-durable-object.ts`, `fetch-source.ts` (start → DO)
- `wiki/wrangler.toml` (`CHAT_IMPORT_DO` binding + migration `v4`)
- `wiki/migrations/0042_google_chat_import_do.sql`
- `wiki/app/locales/{ja,en}/common.json`
- `docs/google-chat-setup.md` (new, instructions for the Google Cloud side)

## Verification — completion criteria and validation

### Completion criteria

Historical logs from the selected Space are stored as monthly raw Markdown, and cron appends only new content.
Users missing scopes see a reauthorization path.

### Commands

```bash
pnpm --filter @gdgjp/wiki migrate:local
pnpm --filter @gdgjp/wiki test
pnpm ci:quick
```

### Required unit-test coverage

Make `google-chat.ts` normalization fixture-based. **Do not call the live API.**
Use fixture JSON responses from `spaces.messages.list` and snapshot the Markdown output.

- Messages spanning month boundaries are correctly separated into monthly `source_document`s.
- Thread replies are nested with a quote of the parent.
- Only messages after `cursor` are appended.
- When scopes are missing, fetching is not attempted and stops with `error`.

### Manual E2E

1. Disconnect Google once, then reconnect and confirm that the consent screen includes the Chat scopes.
2. Select and register one Space in `/sources`.
3. Confirm that `source_documents` are listed monthly and Markdown uses the `## [timestamp] name` format.
4. Post a new Chat message, refetch, and verify that **only the current month’s** hash changes.
5. Verify that previous months’ `content_hash` values are unchanged.
