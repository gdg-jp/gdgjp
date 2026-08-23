# Phase 3 — Broker wiring, end to end

Part of [the `gws` migration plan](plan.md). Depends on Phase 1 (the `accounts.gdgs.jp`
token-vending endpoint must exist) and Phase 2 (`gws.ts` and the Shell allowlist must exist, with
its token source currently short-circuited to an env var). This phase connects the two for real
and requires a coordinated change in the external xangi fork.

## Goal

Replace `gws.ts`'s Phase-2 env-var token stub with the real per-Discord-user flow: the invoking
Discord user's identity resolves, through xangi's existing account-linking, to a short-lived
Google access token — obtained without ever giving the sandboxed slot process access to any
long-lived credential.

## Why this isn't a simple CLI hop from the slot

An earlier draft had `gws.ts` (running as the slot uid, `gdgagent-run-<N>`) itself spawn `gdg
agent workspace-token --sub <gdgSub>` or read `gdgagent-svc`'s credentials directly. Both are
impossible under Stage 07's uid isolation: `/home/gdgagent-svc/.config/gdg/credentials.json` is
`gdgagent-svc:gdgagent-svc 0600` — not readable by a slot uid. A slot-supplied `--sub` would also
be a confused-deputy risk: nothing would stop a compromised slot from requesting a token for an
identity other than the one actually bound to its own run.

The fix uses the channel that already crosses this exact privilege boundary today: the per-slot
authz Unix socket (`gdgagent-svc:gdgagent-run-<N>`, mode `0660`), which `resolveAuthz()` already
uses for `/resolve`. This phase adds a second endpoint on that same socket.

## Concrete changes

**New `gdg` CLI command**: `cli/internal/command/agent_workspace_token.go` — `gdg agent
workspace-token --sub <gdgSub>`, following `cli/internal/command/accounts.go`'s
`withAccessToken()` pattern (load `gdgagent-svc`'s own stored credentials → call → refresh-on-401
→ retry) for calling Phase 1's `api.agents.google-workspace-token.ts`. **This command is invoked
only by the xangi authz-server** (which runs as `gdgagent-svc` and can read its own credential
file) — never by `gws.ts` or anything running as a slot uid.

**`cli/internal/wiki/hooks/acl-core.ts`**: `resolveAuthz()`'s return type gains `gdgSub: string |
null`, so `gws.ts` can distinguish "not linked" from "linked" from the same `/resolve` call it
already makes, without an extra round trip.

**`cli/internal/wiki/hooks/gws.ts`**: replace the Phase-2 env-var stub with the real flow:
- Call `resolveAuthz()`. If `gdgSub` is missing, fail with a clear, agent-visible message
  ("connect Google Workspace first: run /login in Discord, then accounts.gdgs.jp/settings") — a
  normal tool-output error, not a crash.
- If present, call the authz socket's new `/workspace-token` endpoint (over the same nonce already
  used for `/resolve`) and get back a short-lived Google access token only — never a refresh
  token, never written to disk, never passed as a `--sub`-style argument the mediator controls.
- Everything downstream (fresh config dir, env sanitization, exec) is unchanged from Phase 2.

## External prerequisite: `github.com/Harineko0/xangi` (cannot be done from this checkout)

Precise, narrow ask for that repo — hand this section to whoever works there:

1. In the authz-server's `/resolve` handler, alongside the existing `classes`/`channelAudience`
   computation (which already resolves the linked `sub` from `links.json`), add `gdgSub: string |
   null` to the response — `null` when the Discord user has no `/login` link or it's
   expired/unrefreshable.
2. Add a second endpoint, `/workspace-token?nonce=...`, authenticated the same way `/resolve`
   already is (the per-run nonce). The handler resolves `gdgSub` for that nonce **internally**
   (reusing the same lookup `/resolve` does) — it must never accept a caller-supplied user/sub
   parameter, since the whole point is that a slot can only ever request a token for the identity
   already bound to its own run. If `gdgSub` is null, return a clear "not connected" response.
   Otherwise, authenticated as `gdgagent-svc`'s own `gdg login` identity (which the authz-server
   process already has read access to, running as `gdgagent-svc`), call the new
   `accounts.gdgs.jp` token-vending endpoint from Phase 1 — either by shelling out to `gdg agent
   workspace-token --sub <gdgSub>` or calling the HTTP endpoint directly — and return only the
   resulting short-lived Google access token. Never log, cache to disk, or forward the underlying
   Google refresh token; it never leaves `accounts.gdgs.jp`.
3. No change to `links.json`'s stored scopes — it stays login-only; Workspace auth is entirely an
   `accounts.gdgs.jp` concern (Phase 1).
4. Whatever currently gates on "empty classes → refuse" should *not* also require `gdgSub` — a
   user with wiki-editing roles but no Workspace connection should still be able to do everything
   except `gws` calls; `gws.ts` itself is what surfaces the "please connect" message.
5. No change to `XANGI_AUTHZ_NONCE`/`XANGI_AUTHZ_SOCKET` env plumbing or per-slot socket
   isolation — both `gdgSub` and the new endpoint ride the existing nonce-authenticated channel.
6. Extend the authz-server's test coverage for both the new `gdgSub` field and the
   `/workspace-token` endpoint (including: a nonce with no linked account, and confirming the
   endpoint never trusts a client-supplied identity).

## Verification

- The real, still-never-run OAuth E2E: a live Discord message from a test user who has done
  `/login` *and* "Connect Google Workspace" (Phase 1), through the full chain — authz-server →
  `gdgSub` → `/workspace-token` → `gdg agent workspace-token` → `GOOGLE_WORKSPACE_CLI_TOKEN` →
  real `gws` call against a test Drive file.
- Explicitly test the unlinked cases: no `/login` at all, and `/login` without a Workspace
  connection — confirm the graceful error message path in both, not a crash.
- Confirm a slot cannot obtain a token for any identity other than the one bound to its own run
  (there is no parameter path that would let it try).

## Out of scope for this phase

The linking UI and token-vending endpoint itself — Phase 1. The Shell allowlist and install
path — Phase 2. Local dev-loop tooling that avoids needing this full chain for fast iteration —
Phase 4.
