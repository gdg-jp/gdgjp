# LangFuse observability for `agents-local/`

## Revision note (2026-08-24)

A Codex review of the first draft of this plan found that its core premise was factually wrong:
xangi's existing `logs/sessions/*.jsonl` transcript cannot supply tool-use or reasoning data, and
is not append-only. Verified directly against `~/proj/xangi` (the production fork,
`Harineko0/xangi`, commit `125c8c1`):

- `src/cursor-cli.ts`'s `logResponse()` call (invoked from `onComplete`) persists only
  `{ result, sessionId }` — the final aggregated assistant text. Its `createStreamParser()` *does*
  see per-event `tool_call` (`subtype: 'started'` only — there is no completion/result event in
  this parser) and `assistant` text deltas, but routes them to `onToolUse`/`onText` callbacks used
  for live Discord streaming display, never to the transcript logger. No block type resembling
  "thinking"/reasoning is extracted anywhere in `extractAssistantText` (it only reads
  `block.type === 'text'`).
- `src/transcript-logger.ts`'s `rewriteSessionFile()` backs `updateMessageContent`,
  `deleteMessage`, and `attachPlatformMessageIdToLast` — the last of which runs after every
  completed Discord turn to attach the platform message id. The file is not append-only; line
  offsets are not stable watermarks.
- `docs/agents-observability.md` (already in this monorepo, for the sibling Vercel `agents/` app)
  establishes conventions this plan should reuse rather than reinvent: Langfuse Cloud **Japan**
  region (`https://jp.cloud.langfuse.com`), one root `agent`-typed observation per user turn with
  tool spans as *siblings* (not children of a generation), a masking backstop for secrets even
  when `recordInputs`/`recordOutputs` are on, and hashed (not raw) user/session ids.

**Consequence for scope**: capturing tool-use and reasoning requires adding event capture inside
xangi itself — the earlier "stay entirely inside `agents-local/`" scope decision does not survive
contact with how xangi actually works. This plan now spans two repos: `~/proj/xangi`
(`Harineko0/xangi`, your own fork) for capture, and `agents-local/` for the Langfuse-facing
forwarder and deployment. **Confirmed with the user — updating `~/proj/xangi` is in scope.**

## Context

`agents-local/` (submodule `gdg-jp/agents`) is the deployment/config repo for the self-hosted
Discord Q&A bot ("GDG Agent") running on `mincra-srv`:

```
Discord → gdgagent-svc runs xangi.service (Harineko0/xangi fork, /opt/xangi in prod)
        → xangi spawns cursor-agent (closed-source Cursor CLI, model composer-2.5)
             as an isolated uid gdgagent-run-0..3
        → cursor-agent operates on /srv/gdg-agent/wiki via the `wk`/`gws` mediators
             (source lives in the PARENT gdgjp repo's cli/internal/wiki/hooks/, not here)
```

`agents-local/` itself has no LLM SDK code — the model call happens inside the closed-source
`cursor-agent` binary, orchestrated by xangi. xangi's `StreamCallbacks` interface
(`src/agent-runner.ts`) is shared across all its backends (cursor-cli, codex-cli, claude-code,
grok-cli, …), and `src/persistent-runner.ts` is the single place that already has `appSessionId`
in scope and drives `callbacks.onToolUse?.(...)` / `callbacks.onComplete?.(result)` uniformly
across backends — this is the natural interception point for new event capture, not something to
duplicate per-backend in each `*-cli.ts` file.

**Decisions:**
- **Data handling**: full conversation/tool content, no content masking — confirmed by the user.
  This does **not** extend to credentials: adopt the same masking backstop `agents/lib/langfuse.ts`
  already uses (redact `Bearer …` tokens, JWT-shaped strings, exact matches of configured secret
  env values) and hash `userId`/`sessionId` rather than sending raw Discord ids, matching
  `docs/agents-observability.md`'s existing data policy for the sibling app. This is a narrow
  credential/identifier floor, not a reversal of the "full content" decision.
- **Hosting**: reuse the existing Langfuse Cloud **Japan** project
  (`https://jp.cloud.langfuse.com`, documented in `docs/agents-observability.md`) rather than a new
  region/project, unless there's a reason for `agents-local/`'s traces to live in a separate
  project — flagged as a confirmation point since this project wasn't known when hosting was first
  decided.
- **Scope**: capture at the xangi runner boundary (new code in `~/proj/xangi`), forward from
  `agents-local/`. See revision note above — this reverses the original "agents-local/ only" scope
  and should be confirmed.

## 1. xangi-side: versioned, append-only observability event log

New file, e.g. `~/proj/xangi/src/observability-logger.ts`, modeled on `transcript-logger.ts` but
deliberately **not** the same file or format — the transcript log's mutability (edits/deletes/
platform-id attachment) is a Discord-UX feature this log must not inherit. Written as
`logs/observability/<appSessionId>.jsonl` under the same `DATA_DIR`, pure append-only, one JSON
object per line, each carrying an explicit `schemaVersion` field from day one so `agents-local/`'s
consumer can detect and quarantine future format drift instead of guessing.

**Event shape** (exact TS types to be finalized during implementation, not frozen here):
- `turn_start` — `turnId` (new stable id, generated once per user turn — not reused from
  `sessionId`/message id), `appSessionId`, `backend`, `model`, the actual prompt sent, `createdAt`.
- `tool_call_start` — `turnId`, `toolCallId` (from Cursor's `call_id` where present), `name`,
  `input`, `createdAt`.
- `tool_call_end` — **open item, not guaranteed available**: `cursor-cli.ts`'s current stream
  parser has no completion/result event for tool calls, only `started`. Before assuming this event
  exists, check Cursor CLI's actual `stream-json` output for a tool-completion event type; if none
  exists, `tool_call_end` may only ever carry `status: 'unknown'` (call observed, outcome not
  observable) until/unless Cursor's CLI exposes it.
- `turn_end` — `turnId`, outcome (`complete` / `error` / `cancelled`), the actual visible output
  text, latency ms, token/usage info if the backend ever exposes it (Cursor's aggregate `result`
  response does not currently include per-call token counts — confirm before assuming).
- `thinking`/reasoning — **only if Cursor's stream genuinely emits a recognizable block type for
  it**. Today's `extractAssistantText` only reads `type === 'text'` blocks; nothing else is
  extracted. Do not add a reasoning field to the schema on spec — add it only once a real reasoning
  block is observed in Cursor's stream-json output, and treat its absence as an acceptable gap
  (Cursor is closed-source; xangi cannot expose what Cursor never emits), not a plan failure.

**Integration point**: wire this into `persistent-runner.ts` alongside the existing
`callbacks.onToolUse?.(...)` / `callbacks.onComplete?.(result)` calls (it already has
`appSessionId`, tool name/input, and the final result in scope at both call sites — see lines
~342, ~358, ~422, ~477-478), not into each backend's `*-cli.ts` individually, so every backend
(not just Cursor) gets the same event stream for free.

This event log is xangi's own concern — the `agents-local/`-side plan below only reads it.

## 2. `agents-local/`-side: `lib/langfuse-forwarder/`

Standalone Node/TypeScript tool, source-of-truth in-tree:

```
agents-local/lib/langfuse-forwarder/
  package.json          # deps: langfuse SDK — verify current package name/major/API at
                         # implementation time via the `langfuse` skill / live docs, not from memory
  tsconfig.json
  src/
    index.ts             # entrypoint: locate event logs, parse, forward, checkpoint
    events.ts            # DATA_DIR / logs/observability/*.jsonl discovery
    parse.ts             # event JSON -> Langfuse trace/observation mapping, schemaVersion checks
    state.ts             # idempotency-key tracking (not a byte/line watermark)
    mask.ts              # secret/credential masking backstop + userId/sessionId hashing
    config.ts            # credentials + env loading
  fixtures/
    sample-events.jsonl  # synthetic/redacted fixture captured from a real run (see Verification)
  test/
    parse.test.ts
```

Runtime: Node 22.18+ (already guaranteed on the host), `tsx`, mirroring xangi's own execution
style — no new build tooling introduced.

**Trace/observation model** (corrected per Langfuse best practices and
`docs/agents-observability.md`'s existing pattern):
- One Langfuse **session** per xangi conversation (`appSessionId`).
- One Langfuse **trace per turn** (`turnId`), with a root `agent`-typed observation — not one
  trace per session-file, and not a `generation` for the aggregate result. The saved `result` is
  the agent's own output, not a directly-observed model call; labeling it `generation` invents
  model semantics we don't have (no per-model-call input/output/timing/token data is available
  from Cursor today). Only emit a `generation` observation if/when genuinely model-call-level data
  becomes available (see open items).
- `tool_call_start`/`tool_call_end` pairs → `tool`-typed observations as **siblings** of the root
  agent observation (or of whatever nested span issued them), never nested under a synthetic
  generation.
- `userId` (hashed, see masking below) and `sessionId` set from the event stream's `appSessionId`.

**Idempotent forwarding, not line watermarks**: since the source is now append-only with a stable
`turnId`/event identity (unlike the old mutable transcript), track forwarded state as a set of
already-forwarded `(turnId, eventType)` keys (or a per-session "highest fully-forwarded turnId" if
turns are strictly ordered and never partially forwarded) in
`/home/gdgagent-svc/.local/share/langfuse-forwarder/state.json` (0700 dir / 0600 file,
`gdgagent-svc`-owned, outside both the wiki worktree and xangi's `DATA_DIR`). Write via temp-file +
atomic rename. Advance state only after a confirmed Langfuse flush of that batch — a failed flush
retries next run without re-deriving byte offsets.

**Unknown/malformed records**: validate `schemaVersion` on every line. A record with an
unsupported version, or one that fails shape validation, is **quarantined** (written to a
`quarantine/` sibling file or a dead-letter log with the parse error) and its batch's checkpoint is
**not** advanced — do not silently skip-and-advance, which would turn a future xangi schema change
into permanent silent data loss. Surface quarantine counts and time-since-last-successful-run as
health signals (journald at minimum).

**Masking backstop** (`mask.ts`): before sending to Langfuse, deep-walk-mask `Bearer …` tokens,
JWT-shaped strings, and exact matches of configured secret env values (mirror
`agents/lib/langfuse.ts`'s approach — reuse it directly if it can be shared, otherwise port the
same logic). Hash `userId`/`sessionId` (HMAC with a salt — reuse the existing
`TELEMETRY_ID_SALT` convention if applicable to this host, or a parallel salt for the self-hosted
side) rather than sending raw Discord ids. This does not touch conversation/tool content itself,
which stays unmasked per the user's decision.

**Credentials**: `/home/gdgagent-svc/.config/langfuse/credentials.json`, 0600,
`gdgagent-svc`-owned — mirrors `~/.config/gdg/credentials.json` / `~/.config/xangi/secrets.json`.
Fields: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` (default to
`https://jp.cloud.langfuse.com` per the region decision above, but keep it an explicit field, not
hardcoded, in case a separate project is chosen later). Fail loudly at startup if the file or any
field is missing, same as `start_xangi_service()` gates on `DISCORD_TOKEN`.

**Flush**: call the SDK's flush/shutdown in a `finally` around the whole run (confirm exact method
name against current SDK docs).

**Execution model**: systemd `.timer` + oneshot `.service`, not a long-running poller — unchanged
from the original plan's reasoning (xangi needs a persistent Discord Gateway connection, the
forwarder does not; a timer gets scheduling/retry/logging for free and makes each run's
success/failure independently visible in the journal). 5-minute `OnUnitActiveSec` starting default.

## 3. Deployment wiring in `install.sh`

Unchanged from the original plan's shape (verified against `ensure_xangi_fork()`'s actual
behavior, not assumed): a new `ensure_langfuse_forwarder()` copies
`agents-local/lib/langfuse-forwarder` to `/opt/langfuse-forwarder`, `npm ci`/`npm install`,
`chmod -R a+rX node_modules` — root-owned, not chowned to `gdgagent-svc` (matches
`ensure_xangi_fork()`'s real behavior; this component's genuinely-writable state — credentials,
forwarder state — lives under `gdgagent-svc`'s own `$HOME`, where ownership actually matters). A
`write_langfuse_forwarder_unit()` mirrors `write_xangi_user_unit()` (`.service` + `.timer` pair,
`Environment=DATA_DIR=...`/`LANGFUSE_CREDENTIALS_PATH=...`/`LANGFUSE_FORWARDER_STATE_DIR=...`). A
`start_langfuse_forwarder()` mirrors `start_xangi_service()`'s credentials gate. Wire
`ensure_langfuse_forwarder`/`write_langfuse_forwarder_unit` into `place_live_host()`,
`start_langfuse_forwarder` into `activate_live_host()`, and a credentials check into
`print_remaining()`. No change to `lib/install-layout.sh` (that script is scoped to the
ACL-critical `/opt/gdg-agent` layout; this component is unrelated to the ACL trust boundary).

## 4. Docs to update

- **`agents-local/README.md`** — "Layout" section: add `lib/langfuse-forwarder/`; note the new
  credentials file in the "Remaining" secrets list.
- **`agents-local/ENVIRONMENT.md`** — add `/opt/langfuse-forwarder` to "Production runtime layout"
  and the diagram; add the credentials file to "Secrets (locations only)"; document
  `langfuse-forwarder.service`/`.timer` under "## systemd"; add a row to "What to edit when
  changing behavior".
- **`agents-local/AGENTS.md`** — note that `logs/observability/*.jsonl` (new) is a second,
  append-only log distinct from `logs/sessions/*.jsonl` (existing, mutable), so a future reader
  doesn't conflate the two or assume the transcript log carries tool/reasoning data.
- **`~/proj/xangi`**: the new event log format needs its own documentation (README or inline
  doc-comment on the schema types) since `agents-local/`'s forwarder now depends on it as a
  cross-repo contract — a schema change here is a breaking change for a consumer in a different
  repo, which is easy to miss without an explicit note.
- **`docs/agents-observability.md`**: if `agents-local/` traces land in the same JP Langfuse
  project, add a short cross-reference so the two Langfuse integrations (Vercel `agents/` and
  self-hosted `agents-local/`) are discoverable from each other and don't silently drift apart in
  convention (trace naming, masking approach, scoring).

## 5. Verification

Acceptance criteria first, not "traces exist and don't duplicate": a trace should let an operator
answer, for any turn, — what did the user actually ask, what did we actually show them, did it
complete/error/get cancelled, how long did it take (first-response and total), which
backend/model/release/environment handled it, what tools ran with what duration/status/result, and
(for the wiki-query path) what Wiki paths were retrieved and cited if that's surfaced through
`wk`/`gws` tool calls. Define these as required fields before writing the parser, not after.

**a. Fixture-based unit tests first.** Capture one real event-log sample (from a `~/proj/xangi`
local run or the `dev/` Lima harness below), commit a redacted/synthetic copy as
`lib/langfuse-forwarder/fixtures/sample-events.jsonl`, and unit-test `parse.ts` against it: correct
trace/session/user id extraction and hashing, correct observation typing and sibling nesting, no
dropped tool events, quarantine (not silent drop) on an injected malformed/unknown-version line.

**b. End-to-end via `agents-local/dev/`** (Lima VM; commands confirmed against `dev/README.md`):

```bash
limactl start --name=gdg-agent agents-local/dev/lima-gdg-agent.yaml
limactl shell gdg-agent sudo /mnt/gdgjp-src/agents-local/dev/provision.sh
limactl shell gdg-agent sudo /opt/gdgjp/agents-local/dev/seed-iam.sh
limactl shell gdg-agent sudo /opt/gdgjp/agents-local/dev/activate.sh
```

1. Requires the xangi-side event-capture change deployed into the VM's xangi (the harness mounts
   `~/proj/xangi` read-only and copies it in — build/point it at a checkout with the new logger).
2. Drop **test** Langfuse Cloud JP project credentials (never production keys) at
   `/home/gdgagent-svc/.config/langfuse/credentials.json` in the VM.
3. Drive a turn that triggers a `wk`/`gws` tool call via the harness:
   ```bash
   limactl shell gdg-agent -- sudo -u gdgagent-svc xangi harness invoke \
     --guild test-guild --channel ch-chapter --user test-user \
     --roles role-organizer --message "Summarize the venue-cost policy." --json
   ```
4. Run the forwarder once against the resulting `logs/observability/*.jsonl`.
5. Pull the trace back via API rather than eyeballing the UI (mirroring
   `docs/agents-observability.md`'s own verification step:
   `npx langfuse-cli api traces list --limit 1`), and audit it against
   https://langfuse.com/docs/observability/best-practices (fetch fresh — don't audit from memory):
   root `agent` observation, tool calls as siblings with correct typing, hashed `userId`/
   `sessionId`, no raw secrets/tokens present (grep the payload for `Bearer `, the raw Discord id,
   and the access token — all must be absent, same check `docs/agents-observability.md` already
   runs for the sibling app).
6. Re-run with no new turns → zero duplicate traces (idempotency-key correctness). Add a second
   turn, re-run → confirm only the new turn forwards.
7. Add a short LangFuse section to `dev/README.md` once working (how to seed test credentials,
   where to look in the UI), mirroring the existing `gws` fake-token dev-loop section.

## Open items to resolve during implementation

1. **Whether Cursor's stream-json exposes a tool-call completion/result event at all** — today's
   parser only observes `started`. If it doesn't, `tool_call_end`/result may be structurally
   unavailable via this backend, not just unimplemented — this bounds what "tool-use" observability
   can actually contain for Cursor specifically (other backends behind the same `StreamCallbacks`
   interface may differ).
2. **Whether any reasoning/thinking block type is ever present in Cursor's stream** — none is
   extracted today; do not add a schema field for it until one is actually observed.
3. **Whether per-call token/usage data is available from any backend** — needed to decide whether
   a real `generation` observation is ever justified, and from which backend.
4. **Current LangFuse SDK specifics** — package name/version, idiomatic trace/agent/tool
   observation creation in the TS SDK, session/user tagging API. Verify via the `langfuse` skill /
   live docs at implementation time.
5. **Whether `agents-local/` traces should share the existing JP Langfuse project or use a
   separate one** — confirm with the user; this plan defaults to sharing it.
6. **Timer interval** (5 min proposed) — tune against real traffic once live.

### Critical files
- `~/proj/xangi/src/persistent-runner.ts` — integration point for new event capture (has
  `appSessionId`, tool/complete callbacks already in scope).
- `~/proj/xangi/src/observability-logger.ts` (new) — append-only event log, modeled on but
  separate from `src/transcript-logger.ts`.
- `~/proj/xangi/src/cursor-cli.ts` — reference for what Cursor's stream actually exposes today
  (`createStreamParser`, `extractToolUse`, `extractAssistantText`).
- `agents-local/install.sh` — `ensure_langfuse_forwarder`, `write_langfuse_forwarder_unit`,
  `start_langfuse_forwarder`, wired into `place_live_host`/`activate_live_host`/`print_remaining`.
- `agents-local/README.md`, `agents-local/ENVIRONMENT.md`, `agents-local/AGENTS.md` — doc updates.
- `agents-local/dev/README.md` — add LangFuse verification section once working.
- `agents-local/lib/install-layout.sh` — reference pattern only, not modified.
- `docs/agents-observability.md`, `agents/lib/langfuse.ts` — existing conventions to reuse
  (masking, trace modeling, region).
- New: `agents-local/lib/langfuse-forwarder/**`.
