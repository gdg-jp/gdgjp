# jobs — agent job queue (knowledge platform v2)

`agent_jobs` (D1) is the queue between the Worker (producer) and the OCI runner (consumer,
Stage 04). Write it only through this feature.

- `shared.ts` — job types, statuses, priorities, payload shapes.
- `enqueue.server.ts` — `enqueueSynthesize` (one queued job per space, merged; at most one run
  per hour per space unless "integrate now"), `enqueueSynthesizeForSource` (after an import),
  `enqueuePendingSynthesis` (hourly sweep).

A document is pending while `source_documents.integrated_hash != content_hash`; the runner sets
it when it reports a job as succeeded.
