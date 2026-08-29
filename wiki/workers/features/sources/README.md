# sources (Worker side)

Worker-side multi-source ingestion (Google Docs, Chat, Discord, websites): fetch a source and
run its resumable import phases. UI/API side is `app/lib/sources.server.ts`.

- `fetch-source.ts` — `fetchSource`, `enqueueDueSourceRefreshes`; holds the cron strings.
- `import/run.ts` + `import/tick.ts` — the `SOURCE_IMPORT_DO` alarm self-chain loop.
- `import/drive/`, `import/website/` — per-driver phase modules.

Import continuation runs in DO alarms, not `SOURCE_FETCH_QUEUE` (start messages only).
