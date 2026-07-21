# Ingestion worker architecture

The ingestion feature uses D1 as its source of truth. The Agents SDK is a runtime adapter for
session-scoped RPC, coarse state projection, Workflow tracking, and display-safe realtime events.

- `orchestration/` contains framework-neutral state transitions, use cases, and ports. It must not
  import Agents SDK, AI SDK, Drizzle, or Cloudflare binding types.
- `model/` owns prompts, schemas, AI SDK execution, and the model/tool loop.
- `tools/` owns a read-only mounted filesystem. `/wiki`, `/google-docs`, `/google-forms`, and
  `/websites` implement one relative-path adapter contract and are exposed to models through
  absolute-path `ls`, `cat`, and `search` tools. Nodes can be both readable and listable.
- `persistence/` owns D1/R2 adapters and JSON codecs.
- Files at this directory's root are Worker-side composition adapters. They may bind the four
  layers to `Env`, but UI routes must not import their internal implementations.

Each user checkpoint starts a new phase Workflow. Large uploads are written to R2 before the Agent
is called, so Agent state and Workflow payloads contain references only. Realtime delivery is
best-effort and at-least-once; reconnect recovery always reads the durable D1 snapshot.

User-authored text and clarification answers are direct model context. External material is stored
as one R2 object per document, tab, form, or canonical URL and is read lazily through its mount.
There is no cumulative workspace token budget; each tool result is locally bounded and cursor-based,
and duplicate calls within a model run share the same underlying read. Each planned page is drafted
in an isolated model invocation using only its selected evidence paths.
