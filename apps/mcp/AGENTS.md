# CLAUDE.md — `@gdgjp/mcp`

Read `README.md` and `ARCHITECTURE.md`. Rules that keep this Worker safe:

- No LLM: no `[ai]` binding, no model SDKs, no LLM keys.
- Never decide permissions here. Tools call the owning app's API as the signed-in person; the app
  decides what they may see or change.
- Never return or log the Accounts tokens in `props`, and never accept an Accounts token as an MCP
  token (no passthrough): `/mcp` only accepts tokens this authorization server issued for its
  resource.
- Consent before the Accounts redirect, every time, through the library's consent helpers
  (`beginConsent` / `approveConsent` / `beginUpstream` / `finishUpstream`). Escape everything a
  client registered.
- New write tools take `scopeChallenge: requireScopes(WIKI_READ, WIKI_WRITE)` (or their service's
  write scope) and `readOnlyHint: false`.
- `pnpm dev` passes `--local-upstream`: without it wrangler rewrites `request.url` to the
  production route and every OAuth URL check fails.
