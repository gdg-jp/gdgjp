# sources

Source ingestion as seen from RR routes/loaders/actions. Worker-side execution (DO alarms,
refresh cron, per-driver phases) lives in `workers/features/sources/` — see its README.

- `sources.server.ts` — create / inline-create / unarchive / delete / refresh / visibility.
- `shared.ts` — types + helpers shared with the Worker side and the UI.
- `components/` — `SourceList*`, `SourcesToolbar`, `source-selects`, `filter-sources`.

Caveat: conversation-type sources are excluded from 3 read surfaces + search — see
`tests/architecture/source-surface-exclusions.test.ts` and `search-source-exclusions.test.ts`.
