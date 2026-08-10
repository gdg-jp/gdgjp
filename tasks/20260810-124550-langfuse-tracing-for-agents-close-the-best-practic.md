# Langfuse tracing for `agents/` — close the best-practices gaps

> Generated from Claude Code plan: `/Users/hari/.claude/plans/use-langfuse-skills-and-melodic-quill.md`

## Goal

Langfuse tracing for `agents/` — close the best-practices gaps

## Repo context

`agents/` is the Next.js-on-Vercel app that answers Discord `/ask` and Google Chat mentions by
running an AI SDK v6 `ToolLoopAgent` over the Wiki, then deciding in a second `generateObject`
pass whether to file the answer back. Until the current unstaged changes it had **no telemetry at
all** — no way to tell that the agent had degraded.

The unstaged work already builds most of the instrumentation and it is in good shape: AI SDK v6
`experimental_telemetry` + `LangfuseSpanProcessor`, one trace per Chat turn, HMAC-pseudonymized
`userId`/`sessionId`, readable root input/output, eight deterministic scores, judge metadata, a
fail-closed disabled path, and JP-region docs. `pnpm --filter @gdgjp/agents test` passes (114
tests) and `typecheck` is clean.

Auditing it against the current Langfuse best-practices page and the installed `@langfuse/*`
v5.10.0 type surface turned up a handful of real gaps. This change closes them. Two of them
(the flush wiring and the missing mask) are correctness/safety issues, not polish.

**Decisions already made:** rename the root observation to the verb-first `answer-inquiry`; skip
the live trace audit in this session (no Langfuse keys to hand) and leave it as a written
checklist instead.

## Acceptance criteria

(no Approach / Plan / Implementation section in the source plan)

## How to verify

Offline, all runnable now and all expected to pass with **no** Langfuse keys set (which is itself
the proof that the disabled path is a true no-op):

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm --filter @gdgjp/agents typecheck
```

```bash
pnpm --filter @gdgjp/agents build
```

The build is the one that matters for §1 — it confirms `instrumentation.ts` and the OTel packages
do not break the Next bundle. If it fails on an OTel package, add it to `serverExternalPackages`
in [next.config.ts](agents/next.config.ts).

```bash
pnpm ci:quick
```

Deferred to when you have JP keys — this is the langfuse skill's required self-audit loop, and
until it runs, serverless flush and span nesting remain unproven. It will be written into
`docs/agents-observability.md`:

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
7. Create the three evaluators from `docs/agents-observability.md` at 100% sampling, confirm they
   score, then drop to 20%.

## Constraints

- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).
- Do not touch files outside the list above unless the task explicitly requires it.
- Do not rename public APIs unless the task asks for it.
- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.
