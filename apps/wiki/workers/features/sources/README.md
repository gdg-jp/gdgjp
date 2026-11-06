# sources (Worker side)

Worker-side multi-source ingestion (Google Docs, Chat, Discord, websites): fetch a source and
run its resumable import phases. UI/API side is `app/features/sources/sources.server.ts`.

- `fetch-source.ts` — `fetchSource`, `enqueueDueSourceRefreshes`; holds the cron strings.
- `import/run.ts` + `import/tick.ts` — the `SOURCE_IMPORT_DO` alarm self-chain loop.
- `import/drive/`, `import/website/`, `import/google-chat/`, `import/discord/`,
  `import/discord-guild/` — per-driver phase modules (`phases.ts` = the driver `tick.ts`
  registers; siblings are its step functions + `shared.ts`). `discord-guild` (a whole server)
  runs each selected channel through the `discord/` steps with documents under
  `channels/<channelId>/`.
- When any driver completes, `tick.ts` queues a `synthesize` job for the source's unintegrated
  documents (`app/features/jobs/`); the hourly cron sweeps up anything missed.
- `audience-rewrite.ts` — re-tags raw objects after a visibility change.

Import continuation runs in DO alarms, not `SOURCE_FETCH_QUEUE` (start messages only).
