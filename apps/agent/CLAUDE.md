# CLAUDE.md — `@gdgjp/agent`

Read `README.md` and `ARCHITECTURE.md`. Rules that keep this Worker safe:

- No LLM: no `[ai]` binding, no model SDKs, no LLM keys (`tests/architecture/no-llm-bindings.test.ts`).
- Never decide spaces or redaction here. Choose the reader (`features/inquiry/reader.ts`) and
  let the wiki decide; bundle bodies come only from `/api/agent/page`.
- Public replies (guild channel, Chat space) are generated as the venue principal, never as the asker.
- Verify webhooks before parsing anything else.
