# Land `gdgSub` + `/workspace-token` in xangi's authz-server

## Context

While manually verifying the `gws` (Google Workspace CLI) integration end-to-end in the Lima dev
VM, a call through `xangi harness invoke` asking cursor-agent to use `gws` failed — not at Google
auth, but at identity resolution: `wk: authorization response is incomplete; retry from the agent
launcher`. Root cause: `cli/internal/wiki/hooks/acl-core.ts`'s `resolveAuthz()` (shared by both the
`wk` and `gws` Shell mediators) now requires the authz-server's `/resolve` response to include a
`gdgSub: string | null` field, and fails closed if the key is missing. That field was always
planned as an **external prerequisite** in `github.com/Harineko0/xangi` (see
`docs/agents-local-gws/plan.md`'s "External prerequisite" section), but it was never implemented
there — confirmed directly against `~/proj/xangi` (`src/authz-server.ts`, HEAD `4e1c61e`, in sync
with `origin/main`): its `/resolve` handler only ever returns `{classes, channelAudience}`.

Because `resolveAuthz()` is shared, this doesn't just block the new `gws` feature — it fails
**every `wk` call too** (confirmed by directly testing a plain wk-based harness invoke, which hit
the identical error). This branch of the gdgjp monorepo is 6 commits ahead of `origin/main` and
almost certainly hasn't reached production yet, but deploying it as-is, ahead of this xangi fix,
would break the entire Discord wiki agent — not just Workspace access.

The user chose **option 1**: implement the originally-planned fix in xangi (add `gdgSub` to
`/resolve`, add the new `/workspace-token` endpoint) rather than the client-side compatibility
shim (treating a missing `gdgSub` key as `null`). This plan covers only the xangi-repo side; the
consumer contract on the gdgjp-repo side (`acl-core.ts`'s `resolveAuthz()`/`resolveWorkspaceToken()`,
and the entire `accounts.gdgs.jp` token-vending endpoint + `gdg agent workspace-token` CLI command)
is already implemented and tested — that side is treated as a fixed contract to match, not
something to change.

## Consumer contract to match (already shipped, do not change)

From `cli/internal/wiki/hooks/acl-core.ts`:
- `resolveAuthz()` — `GET /resolve?nonce=...` must return JSON `{classes, channelAudience, gdgSub}`
  where `gdgSub` is always present as either a non-empty string or explicit `null`. Any other shape
  (key missing, wrong type, empty string) fails closed.
- `resolveWorkspaceToken()` — `GET /workspace-token?nonce=...` (client-side 8000ms timeout).
  **200** → `{"access_token": string}`. **404** → treated as "not connected" regardless of body
  (used uniformly for "gdgSub is null" and "gdgSub set but no Workspace connection" — this
  intentionally also overlaps with the existing "unknown/expired nonce" 404 convention already used
  by `/verify-acl` and `/repo-lock`; in practice `/workspace-token` is always called moments after a
  successful `/resolve` on the same nonce within the same run, so a genuine expiry race is not a
  real-world concern — this is an accepted tradeoff already baked into the shipped consumer, not
  something to design around). **Any other status** → generic infra error.

## Design decisions (settled, not open)

- **`gdgSub` is resolved once, at nonce-issue time** (`issueGdgPrincipalNonce`), not on each
  `/resolve` call — `resolve()`/`lookup()` are synchronous, in-memory-only today, and issue time
  already has the Discord user id and the `AccountLinkStore` in scope, so this adds no I/O to the
  hot `/resolve` path.
- **`/workspace-token` vends tokens by shelling out to `gdg agent workspace-token --sub <gdgSub>`**
  (already implemented and tested on the gdgjp side), not by reimplementing OAuth token
  storage/refresh natively in xangi. Reasons: reuses proven refresh-on-401 logic instead of
  duplicating it in TypeScript; avoids making xangi a second, unsynchronized writer to
  `gdgagent-svc`'s Go-owned `~/.config/gdg/credentials.json` (that store also tries an OS keyring
  first, an assumption a native TS reader would have to silently replicate); and matches the exact
  existing precedent in this file — `defaultVerifyAcl` already shells out to `gdg wiki verify-acl`
  the same way.
- **No changes needed in the gdgjp repo.** Verified end-to-end that `gdg agent workspace-token`'s
  "not connected" (HTTP 404 from `accounts.gdgs.jp`) surfaces as the Go CLI's `*HTTPError.Error()`
  producing the deterministic string `GDG Japan Accounts request failed: 404 Not Found:
  not_connected` on stderr, unwrapped, with Cobra's default `exit 1` — no other error path in that
  command produces the substring `not_connected`. A stderr substring check is a reliable signal
  with zero Go-side changes required.

## Files to change (`~/proj/xangi`)

### `src/authz-server.ts`
- Add `WORKSPACE_TOKEN_TIMEOUT_MS = 6_500` near `VERIFY_ACL_TIMEOUT_MS` (line 16).
- `AuthzEntry` (lines 18-24): add `gdgSub: string | null`.
- `AuthzServerDependencies` (lines 32-38) + new exported `VendWorkspaceTokenResult` type (next to
  `VerifyAclResult`, lines 40-41): add
  `vendWorkspaceToken?: (gdgSub: string) => Promise<VendWorkspaceTokenResult>`, result type
  `{kind:'ok';accessToken:string} | {kind:'not_connected'} | {kind:'infra';detail:string}` —
  mirrors `VerifyAclResult`'s three-variant shape.
- Add `defaultVendWorkspaceToken(gdgSub)` after `defaultVerifyAcl` (after line 100): `execFileAsync('gdg',
  ['agent', 'workspace-token', '--sub', gdgSub], {encoding:'utf8', timeout: 6_000})` (no `cwd` — this
  is a bare privileged command, not wiki-scoped), parse stdout JSON, guard `JSON.parse` failures into
  the `infra` branch; on a rejected exec, check `error.stderr` for the substring `not_connected` →
  `{kind:'not_connected'}`, else `{kind:'infra', detail: error.message}`. Register it in
  `defaultDependencies` (line 137 area) as `vendWorkspaceToken: defaultVendWorkspaceToken`.
- `parseNonceQuery`'s pathname union (line ~168): add `'/workspace-token'`.
- `handleConnection()`: add a fourth route match `parseNonceQuery(text, 'GET', '/workspace-token')`
  alongside the existing three (lines 322-324), and a new handler block modeled directly on
  `/verify-acl`'s (340-371): `lookup()` first (unknown→404 `unknown_or_expired`, rate_limited→429);
  if `entry.gdgSub === null` → **404 `{error:'not_connected'}` immediately, without ever calling the
  dependency**; else extend the socket timeout and await `dependencies.vendWorkspaceToken(gdgSub)`,
  mapping `ok`→200 `{access_token}`, `not_connected`→404 `{error:'not_connected'}`, `infra`/rejection
  →503.
- `/resolve` handler (lines 325-339): the response is an explicit field allowlist, not a spread —
  add `gdgSub: result.gdgSub` to it. This one line is what actually unblocks `wk`.

### `src/principal.ts`
- `Principal` interface (9-22): add `gdgSub: string | null`.
- `createPrincipal()` (35-52): add `gdgSub: null` to the returned default object.

### `src/gdg-authz.ts`
- `buildPrincipalFromIdentity()`, right after `principal.channelAudience = channelAudienceOf(policy)`
  (line 107): add `principal.gdgSub = authorization.accountLinks ? (linked?.sub ?? null) : null;`
  — reuses the `linked` binding already computed at line 96-98 (`LinkedAccount | null`, which already
  carries `.sub` today), no new I/O.
- `issueGdgPrincipalNonce()`, in the `server.issue({...})` call (lines 146-152): add
  `gdgSub: principal.gdgSub`.

No changes needed to `src/account-link.ts` (`LinkedAccount.sub` already exists) or
`src/harness-server.ts` (it calls the same `buildPrincipalFromIdentity`/`issueGdgPrincipalNonce`
unmodified, so `xangi harness invoke` picks up the fix automatically — a harness `--user test-user`
with no `links.json` entry will correctly resolve `gdgSub: null`, matching the graceful "connect
Google Workspace first" path rather than a fabricated identity).

## Tests

- **`tests/authz-server.test.ts`**: add `gdgSub: 'sub-123'` to the shared `entry` fixture (lines
  11-17) — required once `AuthzEntry.gdgSub` is non-optional; flows through every test that reuses
  the fixture. Extend the existing `/resolve` test to assert `gdgSub` round-trips; add a case with
  `gdgSub: null` proving the null case survives the response allowlist (the exact failure mode
  `acl-core.ts` fails closed on). Add a `/workspace-token` suite mirroring `/verify-acl`'s existing
  tests: success via a mocked `vendWorkspaceToken`; `gdgSub: null` on the entry → 404 **and** assert
  the mock was never invoked; dependency signals `not_connected` → 404; dependency returns `infra` or
  rejects → 503; unknown nonce → 404; rate-limited → 429.
- **New `tests/gdg-authz-pipeline.test.ts`**: there is currently no test exercising the full
  `configureGdgAuthorization → buildPrincipalFromIdentity → issueGdgPrincipalNonce` pipeline
  end-to-end (Discord or harness) — this is the actual coverage gap that let the original bug ship
  undetected. Add one: construct a minimal in-memory `IamConfig` granting a role for a synthetic
  guild/channel, start a real `AuthzServer` against a real temp socket (same `createServer()` pattern
  as `authz-server.test.ts`), wire it through `configureGdgAuthorization`, build a principal for a
  synthetic user with no `AccountLinkStore` entry, issue its nonce, and assert a raw `GET /resolve`
  against the socket returns `gdgSub: null`. (New file rather than extending the 33-line
  `tests/harness-invoke.test.ts`, since this needs IAM/AuthzServer scaffolding that file doesn't have.)

## Verification

1. `npm run typecheck && npm run lint && npm test` in `~/proj/xangi` — since `AuthzEntry.gdgSub`
   becomes required, typecheck will catch any other construction site if one was missed (confirmed
   only `gdg-authz.ts:146` constructs this literal today).
2. Re-provision the Lima `gdg-agent` VM against the updated `~/proj/xangi` checkout (it's mounted
   read-only and rsynced by `agents-local/dev/provision.sh`), then re-run the exact two harness
   invocations that surfaced this bug:
   - A plain wiki-reading harness invoke (no `gws` involved) — should now succeed instead of failing
     with `authorization response is incomplete`.
   - The `gws drive files list` harness invoke — should now reach the "connect Google Workspace
     first: run /login in Discord, then accounts.gdgs.jp/settings" graceful-failure message (since
     the synthetic `test-user` has no real link), rather than the identity-resolution error.
3. Optionally, re-run `dev/seed-gws-fake-token.sh`'s fake-stub check (already verified working
   earlier) to confirm it's unaffected — it implements its own `/resolve`+`/workspace-token` stand-in
   and doesn't depend on this xangi change at all, so it should be unaffected either way.
