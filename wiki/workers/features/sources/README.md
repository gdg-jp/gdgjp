# sources (Worker side)

Worker-side multi-source ingestion (Google Docs, Chat, Discord, websites): fetch a source and
run its resumable import phases. UI/API side is `app/features/sources/sources.server.ts`.

- `fetch-source.ts` — `fetchSource`, `enqueueDueSourceRefreshes`; holds the cron strings.
- `import/run.ts` + `import/tick.ts` — the `SOURCE_IMPORT_DO` alarm self-chain loop.
- `import/drive/`, `import/website/`, `import/google-chat/`, `import/discord/` — per-driver phase
  modules (`phases.ts` = the driver `tick.ts` registers; siblings are its step functions + `shared.ts`).

Import continuation runs in DO alarms, not `SOURCE_FETCH_QUEUE` (start messages only).
