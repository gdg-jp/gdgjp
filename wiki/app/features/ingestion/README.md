# ingestion (client side)

Client wiring for wiki generation. The logic runs in the Worker under
`workers/features/ingestion/` (orchestration / model / tools / persistence) — see its README.

- `agent-client.ts` / `use-ingestion-agent.ts` — `useAgent()` transport for `/ingest/:sessionId`.
- `live-activity.ts` — display-safe realtime event projection.
- `slug.ts` — `generateSlug`, also reused by `zip-import/` and `google-documents/`.

Consumed by `app/routes/ingest/` and `app/routes/api/ingest/`.
