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

## Generation observability

The clarify, plan, draft, schema-repair, and regeneration phases are observable without adding
diagnostic data to the realtime protocol or to D1. Every generation run carries these correlation
IDs:

- `sessionId`: the stable generation session and the Analytics Engine sampling index.
- `workflowId`: the Cloudflare Workflow invocation for the current user checkpoint.
- `runId`: the phase run within that workflow.
- `modelCallId`: one physical model request, including an exploration step or schema repair.

Workers Logs contains structured application events for workflow and phase boundaries, state
transitions, tool invocations/results, validation, persistence, and errors. Tool results are
bounded text and never include API keys, OAuth tokens, or binary contents. Prompt and completion
payloads are intentionally not duplicated there: AI Gateway is the system of record for them.

Workers Traces records the nested workflow, phase, model, tool, validation, and persistence spans.
Its searchable attributes contain only correlation IDs and low-cardinality fields; inspect the
corresponding structured event for details that would be too high-cardinality for a span.

### Production setup

1. In the Cloudflare account that owns `gdgjp-wiki`, create an authenticated AI Gateway named
   `gdgjp-wiki-generation`. Configure its Google AI Studio provider endpoint and enable request
   and response payload logging. Set the gateway's retention/access policy before enabling it:
   prompts and completions can contain user-authored or imported material.
2. Set `AI_GATEWAY_BASE_URL` to that gateway's Google AI Studio-compatible base URL as a Worker
   variable. The account ID is deployment-specific, so it is deliberately not committed to
   `wrangler.toml` or `.dev.vars.example`.
3. Set the gateway credential as a Worker secret:

   ```sh
   cd wiki
   wrangler secret put AI_GATEWAY_TOKEN
   ```

4. Deploy the Worker. `wrangler.toml` enables persisted Workers Logs at 100% head sampling and
   persisted Workers Traces at 10%. It also binds `WIKI_AI_TELEMETRY` to the
   `wiki_ai_model_calls` Analytics Engine dataset.

Only local/test execution may fall back to direct Gemini when Gateway configuration is absent.
Production must fail configuration validation rather than silently bypassing the Gateway.

Each Gateway request includes payload logging and a `cf-aig-metadata` header with at most five
entries: `session_id`, `workflow_id`, `run_id`, `model_call_id`, and `program`.

### Investigating one generation

Start with any known correlation ID, usually `sessionId` or `modelCallId`.

1. Filter Workers Logs for that ID to reconstruct phase transitions, D1 state changes, tool
   inputs/results, validation, repair, and persistence events.
2. Open the matching Workers Trace and follow the nested workflow/phase/model/tool spans to find
   latency and the external dependency responsible for it. Traces are sampled at 10%, so a log
   may legitimately have no trace.
3. In AI Gateway Logs, filter custom metadata by the same `session_id` or `model_call_id` to view
   the exact prompt, completion, provider response, token usage, and Gateway duration.
4. Use Analytics Engine for aggregate comparisons; it intentionally stores metrics and dimensions,
   not the complete model payload.

### Analytics Engine schema and queries

`wiki_ai_model_calls` writes one datapoint per physical model request. Its fields are stable for
operational queries:

| Field | Meaning |
| --- | --- |
| `index1` | `sessionId` (the only sampling index) |
| `blob1`–`blob6` | model, prompt version, program, stage, outcome, finish reason |
| `double1`–`double8` | latency ms, input tokens, output tokens, total tokens, input chars, output chars, tool count, repair count |

Run these in the Cloudflare Analytics Engine SQL API/Explorer, replacing the time interval as
needed:

```sql
-- Model-level latency, token usage, and failures.
SELECT
  blob1 AS model,
  sum(_sample_interval) AS calls,
  sum(double1 * _sample_interval) / sum(_sample_interval) AS avg_latency_ms,
  quantileExactWeighted(0.95)(double1, _sample_interval) AS p95_latency_ms,
  sum(double4 * _sample_interval) / sum(_sample_interval) AS avg_total_tokens,
  sumIf(_sample_interval, blob5 != 'success') AS failed_calls
FROM wiki_ai_model_calls
WHERE timestamp >= now() - INTERVAL '7' DAY
GROUP BY model
ORDER BY calls DESC
```

```sql
-- Schema-repair and regeneration rates by model and workflow program.
SELECT
  blob1 AS model,
  blob3 AS program,
  sum(_sample_interval) AS calls,
  sum(double8 * _sample_interval) AS schema_repairs,
  sumIf(_sample_interval, blob3 = 'regenerate') AS regeneration_calls,
  round(100 * sum(double8 * _sample_interval) / sum(_sample_interval), 2) AS repairs_per_100_calls
FROM wiki_ai_model_calls
WHERE timestamp >= now() - INTERVAL '7' DAY
GROUP BY model, program
ORDER BY schema_repairs DESC
```

```sql
-- Diagnose one session across its individual model calls.
SELECT
  timestamp,
  blob1 AS model,
  blob3 AS program,
  blob4 AS stage,
  blob5 AS outcome,
  blob6 AS finish_reason,
  double1 AS latency_ms,
  double4 AS total_tokens,
  double7 AS tool_count,
  double8 AS repair_count
FROM wiki_ai_model_calls
WHERE index1 = 'SESSION_ID'
ORDER BY timestamp ASC
```

Cloudflare permits no more than five custom metadata entries per AI Gateway request; keep the
correlation metadata exactly as above. See the Cloudflare documentation for
[AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/),
[custom metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/),
[Workers traces](https://developers.cloudflare.com/workers/observability/traces/), and
[Analytics Engine SQL](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/).
