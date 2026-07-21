# Ingestion worker architecture

The ingestion feature uses D1 as its source of truth. The Agents SDK is a runtime adapter for
session-scoped RPC, coarse state projection, Workflow tracking, and display-safe realtime events.

- `orchestration/` contains framework-neutral state transitions, use cases, and ports. It must not
  import Agents SDK, AI SDK, Drizzle, or Cloudflare binding types.
- `model/` owns prompts, schemas, AI SDK execution, and the model/tool loop.
- `tools/` owns bounded source and Wiki exploration tools. Tool arguments and outputs never cross
  the realtime event boundary.
- `persistence/` owns D1/R2 adapters and JSON codecs.
- Files at this directory's root are Worker-side composition adapters. They may bind the four
  layers to `Env`, but UI routes must not import their internal implementations.

Each user checkpoint starts a new phase Workflow. Large uploads are written to R2 before the Agent
is called, so Agent state and Workflow payloads contain references only. Realtime delivery is
best-effort and at-least-once; reconnect recovery always reads the durable D1 snapshot.
