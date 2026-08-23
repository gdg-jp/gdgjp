# Phase 4 — Lima VM dev loop + docs

Part of [the `gws` migration plan](plan.md). Depends on Phases 1–3 being at least designed (ideally
landed) so the docs describe the real shipped behavior rather than the old MCP design.

## Goal

Give local development on the Lima VM a fast iteration loop that doesn't require running the full
OAuth linking flow end to end for every test, and leave the operational docs accurately describing
the new `gws` + per-user-auth model instead of the removed MCP integration.

## Concrete changes

**Delete**: `agents-local/dev/configure-google-workspace-mcp.sh`,
`agents-local/dev/open-google-workspace-oauth-tunnel.sh` — these solved a problem that no longer
exists (a local browser-redirect callback for a device-local OAuth flow). Token vending is
server-side now (Phase 1/3), not device-local, so there's no tunnel to open.

**New**: a Lima-VM dev script that seeds a **fake** `google_workspace_connections` row (or stubs
the token-vending endpoint's response) for a test GDG identity, so a developer can exercise
Phase 2/3's `gws.ts` path locally without doing a real Google OAuth consent every time. Keep this
clearly test-only — it must not be reachable or reused against the production `accounts.gdgs.jp`
token-vending endpoint's real gating.

**Rewrite**:
- `agents-local/ENVIRONMENT.md` — replace the "google-workspace MCP" paragraph describing the old
  shared-account wrapper with a description of the `gws` mediator + per-user auth model, the new
  `/opt/gdg-agent/bin/gws`/`gws-bin` layout, and where the authz-socket `/workspace-token`
  endpoint fits into the runtime chain.
- `agents-local/AGENTS.md` — replace the "google-workspace MCP（運用メモ）" section. Keep the
  Sheets operational notes (protected-range/`insertDimension` quirks, the `googleapiclient`
  fallback script) since those are Google-API facts independent of the auth model — just retarget
  them at the equivalent `gws sheets` calls once those specific subcommands are allowlisted
  (Phase 2/3 start with `drive.readonly` only; don't imply Sheets-write access exists until it's
  actually in `gwsAllowlist`). Update the authentication-account note (`gdgkwansai@gmail.com`) to
  describe per-Discord-user accounts instead of one shared account.
- `docs/agents-local-testing/iam-e2e-runbook.md` — the sections added for the old design describe
  an OAuth E2E test that was never actually run; replace with a runbook for the new model: linking
  a test account (Phase 1), confirming `/login` + "Connect Google Workspace" together produce a
  working `gws` call, and confirming the unlinked-state error paths from Phase 3's verification
  list.
- `docs/agents-local-testing/cursor-cli-harness-timeout.md` — this recorded an unrelated harness
  bug (fixed) that blocked the old OAuth E2E test from running; either close it out with a note
  that the underlying test it was blocking has been superseded by the new runbook above, or leave
  it as historical record if it still has standalone value for the harness-timeout fix itself.

## Verification

- Run the new fake-seed dev script in the Lima VM and confirm a `gws.ts` call succeeds end to end
  without any real Google OAuth interaction.
- Read the rewritten docs and confirm no leftover reference to the shared `gdgkwansai@gmail.com`
  account model, `uvx`/`workspace-mcp`, or the deleted OAuth-tunnel scripts remains anywhere in
  `agents-local/` or `docs/agents-local-testing/`.

## Out of scope for this phase

Any production-path code — Phases 1–3 own all of that. This phase is dev-loop tooling and
documentation only.
