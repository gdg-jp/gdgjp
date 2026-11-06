# sources

Source ingestion as seen from RR routes/loaders/actions. Worker-side execution (DO alarms,
refresh cron, per-driver phases) lives in `workers/features/sources/` — see its README.

- `kinds.ts` — **the only place that knows what each source kind can do**: `SOURCE_KINDS`
  (stored kind → driver, refreshable, refresh policies, duplicate key, provisional title) and
  `REGISTRATIONS` (add-source entry point → parse / validate / classify / create input / row icon).
  Comparing kind literals elsewhere fails `tests/architecture/source-kind-branches.test.ts`.
  Adding a kind = one row in each table (+ an import driver).
- `audience.ts` — `sourceAudience` (the `audience` R2 metadata) and `readableAudienceKeys`
  (what a reader may see). Pinned to `canAccessSource` by `audience.test.ts`.
- `raw-object.ts` — v2 raw R2 key (`spaces/<space>/raw/<source>/<path>`, one live object per
  document) and its AI Search metadata.
- `sources.server.ts` — create / inline-create / unarchive / delete / refresh / visibility.
  A visibility change re-tags the source's raw objects (`source_audience_rewrite` queue message).
- `shared.ts` — types + helpers shared with the Worker side and the UI.
- `components/` — `SourceList*`, `SourcesToolbar`, `source-selects`, `filter-sources`.

Caveat: conversation-type sources are excluded from 3 read surfaces + search — see
`tests/architecture/source-surface-exclusions.test.ts` and `search-source-exclusions.test.ts`.
