# agents/ LLM observability (Langfuse)

Online tracing and evaluation for `@gdgjp/agents`. Offline datasets / CI regression
harnesses are intentionally out of scope — see the decisions in the implementation plan.

**Not the only Langfuse integration in this monorepo.** The self-hosted Discord bot
(`agents-local/`, xangi + Cursor CLI on `mincra-srv`) has its own, independent Langfuse
integration — see [`docs/agents-local-o11y/plan.md`](agents-local-o11y/plan.md) and
`agents-local/lib/langfuse-forwarder/`. It shares this doc's Langfuse Cloud **Japan** region,
masking approach, and hashed-id convention, but forwards asynchronously from an
append-only event log (batch, via `@langfuse/tracing`'s low-level `startObservation` API with
explicit timestamps) rather than instrumenting a live request the way this app does with
`@langfuse/otel`'s `LangfuseSpanProcessor` — xangi's LLM call happens inside the closed-source
`cursor-agent` binary, so there is no live request to instrument in-process.

**Region:** this project uses Langfuse Cloud **Japan** — <https://jp.cloud.langfuse.com>
(Tokyo, `ap-northeast-1`), alongside the `hnd1` Vercel deployment region. Regions are fully
isolated: accounts, data, and API keys do not cross between them, so every UI step below
happens on the JP host. `LANGFUSE_BASE_URL` must be set — the SDK falls back to the EU
region (`https://cloud.langfuse.com`) when it is missing.

**Access control:** `recordInputs` / `recordOutputs` are enabled. Wiki page bodies retrieved
during a Chat turn are stored in Langfuse (trace I/O + `metadata.retrievedPages`). Treat
Langfuse project membership like Wiki read access: only people who may see chapter Wiki
content should be project members.

**Trace shape:** each Chat question is one root **`answer-inquiry` agent** observation (verb-first
name, `asType: agent` for the Agent Graph). The wiki tool loop nests under it as `wiki-agent`
plus `wiki_ls` / `wiki_cat` / `wiki_search` tool spans. The background filing pass is a sibling
`file-answer` observation with a nested `filing-decision` generation.

**Release tagging:** `VERCEL_GIT_COMMIT_SHA` is sent as the Langfuse `release` automatically on
Vercel — no extra configuration. Use it to correlate quality regressions with deploys.

**Sensitive data masking:** span export runs a deep-walk mask (`agents/lib/langfuse.ts`) that
redacts `Bearer …` tokens, JWT-shaped strings, and exact matches of configured env secrets
(`GOOGLE_VERTEX_API_KEY`, `IDP_CLIENT_SECRET`, `RP_SESSION_SECRET`, `TELEMETRY_ID_SALT`,
`LANGFUSE_SECRET_KEY`, `TOKEN_ENCRYPTION_KEYS`). Masking is a backstop — never log tokens in
application code.

## Deterministic scores (emitted by the app)

Emitted on the `answer-inquiry` trace after each inquiry (and `filing_outcome` after the
filing pass when it runs).

| Name | Type | Meaning |
|---|---|---|
| `outcome_kind` | CATEGORICAL | `answer` \| `needs_link` \| `needs_relink` \| `temporarily_unavailable` |
| `cited_path_count` | NUMERIC | Workspace paths returned by `wiki_cat` / `wiki_search` (excludes `/wiki/index`) |
| `answer_cites_paths` | BOOLEAN | Every cited path appears in the answer text (SYSTEM_INSTRUCTIONS rule 8) |
| `unknown_citation_count` | NUMERIC | `/wiki/<slug>` mentions in the answer that were never retrieved from tools (fabricated citations) |
| `step_count` | NUMERIC | Agent steps; watch for sticking at `AGENT_MAX_STEPS` (12) |
| `tool_error_count` | NUMERIC | Tool results whose output includes `error` |
| `index_first` | BOOLEAN | First `wiki_cat` was `/wiki/index` and no `index_required` tool error |
| `answer_chars` | NUMERIC | Reply length |
| `filing_outcome` | CATEGORICAL | `filed` or `not_filed:<reason>` |

## LLM-as-judge evaluators (Langfuse UI only)

Create three **Live Observations** evaluators. No application code changes.

### Shared target

- Target: **Live Observations**
- Filter: observation `name` = `answer-inquiry`
- Sampling: **20%** in production (use 100% briefly when validating a new judge, then restore 20%)
- Variable mapping:
  - `input` → observation input (the Chat question)
  - `output` → observation output (the Chat reply)
  - `citedPaths` → JSONPath `$.metadata.citedPaths`
  - `retrieved` → JSONPath `$.metadata.retrievedPages`

LLM Connection: Google AI Studio (Gemini API key) or Vertex AI — same family as the agent.

### 1. `citation_grounding`

**Score:** NUMERIC 0–1 (1 = fully grounded)

```
You judge whether each factual claim in the assistant's Wiki reply is supported by the
retrieved Wiki page bodies.

Question:
{{input}}

Assistant reply:
{{output}}

Cited workspace paths (from tools):
{{citedPaths}}

Retrieved Wiki page bodies:
{{retrieved}}

Rules:
- Only score claims about venues, people, budgets, procedures, or chapter operations.
- A claim is grounded if the retrieved bodies contain the same fact (paraphrase OK).
- If the reply correctly says the Wiki has no answer, score 1.
- Fabricated page URLs are out of scope (measured by unknown_citation_count).
- Return a single number from 0 to 1 and a short rationale.
```

### 2. `intent_satisfaction`

**Score:** NUMERIC 0–1 (1 = intent satisfied or correctly declined)

```
You judge whether the assistant satisfied the user's intent given only Wiki evidence.

Question:
{{input}}

Assistant reply:
{{output}}

Retrieved Wiki page bodies:
{{retrieved}}

Rules:
- Score 1 if the reply answers the question using Wiki content, or correctly states that
  the Wiki does not have an answer (and optionally offers to register a source).
- Score low if the reply invents operational facts not present in retrieved bodies.
- Score low if the reply ignores a clear question that the retrieved bodies do answer.
- Return a single number from 0 to 1 and a short rationale.
```

### 3. `language_match`

**Score:** BOOLEAN (1 = match)

```
Does the assistant reply use the same primary language as the user's question?

Question:
{{input}}

Assistant reply:
{{output}}

Rules:
- Compare the dominant language of the user's latest message to the reply.
- Short proper nouns or Wiki path URLs do not count as a language mismatch.
- Return 1 if languages match, 0 otherwise, with a one-sentence rationale.
```

## Hobby plan budget

Langfuse Cloud Hobby: **50k units / month**, **30-day retention**, 2 users, LLM-as-judge included.

Rough cost per Chat question: ~25–40 observations + ~8 deterministic scores (+ judge units when
sampled). At 20% judge sampling, plan for about **1,000–1,500 questions / month** before
needing sampling on traces themselves. Retention is 30 days — export if you need longer analysis.

## Runbook — scores dropped, what to look at

1. **`unknown_citation_count` rising** — model inventing `/wiki/...` links. Inspect tool spans
   vs answer text; reinforce citation rules or tighten stop conditions.
2. **`index_first` falling / `tool_error_count` rising** — agent skipping the catalog or
   probing. Check the first `wiki_cat` tool span.
3. **`answer_cites_paths` falling** — exploration found pages but the reply omitted links.
4. **`step_count` pinned at 12** — loop thrashing; look at repeated `wiki_ls` / search.
5. **`citation_grounding` / `intent_satisfaction` falling while deterministic scores look fine** —
   retrieved bodies lack the needed fact, or the judge mapping broke (`retrievedPages` empty).
6. **No traces in Langfuse** — confirm `LANGFUSE_*` on Vercel, then confirm `after()` flush
   (traces should appear shortly after the HTTP response, not only on process exit).

## Data policy checklist

When reviewing a trace in Langfuse:

- [ ] No OAuth access / refresh token strings in inputs, outputs, metadata, or tool I/O
- [ ] `userId` / `sessionId` are HMAC digests (or `anon` if `TELEMETRY_ID_SALT` unset) — never raw Discord / Google Chat ids
- [ ] Question text and Wiki bodies are present (expected — do not “fix” them without a product decision)

## Live verification checklist (requires JP Langfuse keys)

Run this after changing tracing code or before trusting serverless flush / span nesting in production.

1. Put dev keys + `LANGFUSE_BASE_URL=https://jp.cloud.langfuse.com` +
   `LANGFUSE_TRACING_ENVIRONMENT=development` + `TELEMETRY_ID_SALT` in `agents/.env.local`.
2. `pnpm --filter @gdgjp/agents dev`, run one Discord `/ask`.
3. Pull the trace back rather than eyeballing the UI:
   ```bash
   npx langfuse-cli api traces list --limit 1
   ```
4. Audit it against <https://langfuse.com/docs/observability/best-practices> — confirm: root is
   one `answer-inquiry` **agent** observation; `wiki-agent` generation and `wiki_ls`/`wiki_cat`/
   `wiki_search` tool spans nest under it; `file-answer` and its `filing-decision` generation are
   siblings, not dangling; model/token/cost populated on generations; `userId`/`sessionId` are
   digests, never raw Chat ids; all eight deterministic scores present.
5. Confirm the trace lands **shortly after the HTTP response**, not minutes later — that is the
   `after()` flush working, and it is the most likely thing to be broken.
6. Grep the trace payload for the access token, `Bearer `, and the raw Discord id. All must be absent.
7. Create the three evaluators above at 100% sampling, confirm they score, then drop to 20%.
