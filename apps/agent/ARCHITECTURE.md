# Agent Worker architecture

Plain Worker, no framework. `src/index.ts` routes; `src/app.ts` builds the per-request
dependency graph from bindings (tests swap parts). Features under `src/features/` keep the
v1 `apps/agents` split:

- `webhooks` — Discord Ed25519 / Google Chat JWT (JWKS, RS256) verification and KV replay
  dedupe. Runs before anything else; failures return 401 and never reach the wiki.
- `auth` — PKCE linking (state in KV), v1-compatible AES-GCM token keyring, D1 link records
  with compare-and-set refresh, revocation.
- `chat` — Discord interactions (commands, buttons, `/setup` select) and Google Chat events;
  `deliver.ts` edits the deferred Discord response or posts into the Chat thread.
- `inquiry` — reader choice (`reader.ts`), the wiki client (`wiki.ts`), bundle (`bundle.ts`:
  page bodies only from the wiki's redacted `/api/agent/page`, raw only as search snippets),
  `answer` job start, delivery, degraded replies (`inquiry.ts`), pending store.
- `filing` — files a runner-proposed reusable answer as a gdg-jp `answers/*` note, as the
  linked asker, once per question.
- `telemetry` — Langfuse ingestion API; chat ids HMAC'd, no tokens or bundles.

`src/durable/pending-sweeper.ts` is the only Durable Object (one instance) and only sweeps
overdue answers. Permission decisions stay in the wiki; this Worker only chooses the reader.
