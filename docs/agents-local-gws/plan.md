# Replace google-workspace-mcp with official `gws`, per-Discord-user auth

## Context

`agents-local/` (the self-hosted Discord agent, run via the "xangi" backend driving
`cursor-agent`) currently gives its agent Google Docs/Sheets access through
`google-workspace-mcp` — an **unofficial** Python MCP server (`uvx workspace-mcp`), registered
in `.cursor/mcp.json` and authenticated against one shared bot account
(`gdgkwansai@gmail.com`). The user wants this replaced with the official
[`googleworkspace/cli`](https://github.com/googleworkspace/cli) (`gws`).

Two decisions were made explicitly before this plan was drafted (do not relitigate):

1. **`gws` has no MCP server mode** — it is a plain CLI plus a library of Claude/Gemini
   "Agent Skills," nothing else (verified against its README and a GitHub code search: zero
   MCP-related code in the repo). It also self-describes as *"not an officially supported Google
   product"* despite living under the `googleworkspace` GitHub org — worth knowing even though
   it's still the tool being switched to. Since it can't plug into `.cursor/mcp.json`, it will be
   invoked as a **Shell command**, and the existing hand-rolled Shell allowlist
   (`cli/internal/wiki/hooks/shell-allowlist.ts`, hard-locked today to `wk` only) will be
   generalized to accept a second, independently-scoped binary.
2. **Auth must be per-Discord-user, not a shared account.** The user explicitly rejected a shared
   service account or shared bot OAuth account as a security vulnerability: whoever's Discord
   message triggered the agent, Workspace API calls must run under *that person's own* linked
   Google account. This turns the task from a config swap into a small identity-linking feature
   spanning `accounts/` (new OAuth grant + token storage), the `gdg` CLI (a new privileged
   token-vending call), `agents-local`'s sandbox (Shell allowlist + a mediator process), and the
   external xangi fork (passing the invoking Discord user's identity through the existing authz
   channel) — none of that plumbing exists today.

**Before starting**: `git log` shows two commits already on `main` in both the parent repo
(`e513ae7`, "feat(agents): provision Google Workspace MCP") and the `agents-local` submodule
(`c8e941d`, "feat: add Google Workspace MCP support") — both authored by the repo owner, dated
just before this plan was written, currently unpushed (`ahead 1` of `origin/main` in both).
These commits built the *old* MCP-based design (wrapper script reading a slot env file, ACL
allowlist entries for `search_drive_files`, Lima-VM OAuth-tunnel dev scripts). Confirm with the
user whether to keep these on `main` and follow up with revert-shaped diffs (§3 below is written
this way), or reset them before starting — either way, don't silently build on top of them without
accounting for every file they touched.

## Investigation notes (verified, correcting assumptions made along the way)

- `accounts/` has **no Drizzle `schema.ts`** — despite `wiki/` using Drizzle
  (`wiki/app/db/schema.ts`), `accounts/` is raw-SQL-migrations only
  (`accounts/migrations/000N_*.sql` → generated `accounts/schema.sql`, per the root CLAUDE.md:
  "edit migrations, not the generated dump"). The new table goes in a new numbered migration, and
  new routes query D1 directly the way `accounts/app/lib/oauth-clients.server.ts` and neighboring
  `*.server.ts` files already do — there is no ORM table to export.
- `accounts/app/lib/auth.server.ts` is confirmed the single source of truth for the existing
  Google sign-in (`accounts/CLAUDE.md`), which goes through Better Auth's `signInSocial` with
  `provider: "google"` (`accounts/app/routes/oauth.google.start.ts`) — **login-scoped only**, no
  `access_type=offline`, no extra scopes, and it's Better Auth's own `account` table, not
  something to extend for Workspace scopes (risk of silently clobbering the login-linked row).
  Google supports *incremental authorization* (a second, additive consent for more scopes on an
  already-connected app, via a direct `accounts.google.com/o/oauth2/v2/auth` redirect with
  `access_type=offline&prompt=consent&include_granted_scopes=true`) — this is the right primitive
  for "Connect Google Workspace," and it can reuse the **same** GCP OAuth client
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, already a Wrangler secret in `accounts/`) rather than
  provisioning a second one. **Correction**: the new callback URL needs registering as a redirect
  URI directly on that OAuth client in the Google Cloud Console (or via `gcloud`) — this is a
  Google-side setting, unrelated to `accounts.gdgs.jp`'s own `/admin/seed-clients` route.
  `/admin/seed-clients` only seeds GDG's *downstream relying-party* OIDC clients (the
  `AGENTS_CLIENT_ID`-style per-app entries for tinyurl/img/scheduler/etc.); it has no effect on
  the upstream Google Cloud OAuth client `accounts/` itself uses for "Continue with Google," and
  does not need to run for this change.
- `cli/internal/oauth/oauth.go` — the `gdg` CLI's own OAuth client (`clientID = "gdg-cli"`) talks
  to `accounts.gdgs.jp`'s OIDC endpoints directly (not Google's) and already has a working
  `Refresh(ctx, refreshToken)` for renewing `gdgagent-svc`'s own GDG-login token.
  `cli/internal/command/accounts.go`'s `withAccessToken()` helper (load → call → refresh-on-401 →
  retry) is the exact pattern a new `gdg agent workspace-token` command should follow.
- `cli/internal/wiki/hooks/exec-spawn.ts` (~line 61-72): the sandboxed process's env is built from
  a fixed allowlist (`PATH, HOME, USER, XANGI_AUTHZ_NONCE, XANGI_AUTHZ_SOCKET, GDG_WIKI_RUN_ID`,
  plus conditional `LANG/TZ/CURSOR_API_KEY/GDG_WIKI_LOCK_OWNER`) set once per agent run, not per
  Shell call. `XANGI_AUTHZ_SOCKET`/`XANGI_AUTHZ_NONCE` (resolved by `resolveAuthz()` in
  `cli/internal/wiki/hooks/acl-core.ts`, today returning `{classes, channelAudience}`) is the
  existing, already-wired channel to extend with an identity claim — no new env plumbing needed.
- **xangi (`github.com/Harineko0/xangi`) already resolves Discord-user → GDG account.** Per
  `docs/agents-local-mvp/04-xangi-authz-iam.md` §4 (Stage 04, marked done in
  `docs/agents-local-mvp/todos.md`), a `/login` Discord slash command already does device-code
  auth against `gdg-cli` and stores `links.json`: `{discordUserId: {sub, chapters, refreshToken,
  expiresAt}}`. Its authz-server already looks this up to compute `classes`/`channelAudience`.
  This means the external-repo change needed is much narrower than "add identity plumbing from
  scratch" — it's "thread the `sub` xangi already has into the existing `/resolve` response."
  That stored token is scoped to `openid profile email offline_access chapters cli` only — it is
  **not** a Workspace token and cannot be reused for Drive/Sheets calls; a separate consent
  (previous bullet) is still required.
- Existing shipped prior art for an *additive* link stored next to an existing user record:
  `wiki/app/db/schema.ts`'s `discordOauthTokens` table (unrelated feature, but the right shape to
  mirror) plus `wiki/app/routes/api.discord.callback.ts`.

## Recommended design

**Token flow, end to end:**

1. A Discord user already has (or gets, via the existing `/login` slash command) a GDG account
   linked to their Discord identity — no change needed here.
2. They visit accounts.gdgs.jp (signed in as that GDG account) and use a new **"Connect Google
   Workspace"** action — a second, additive OAuth consent (incremental authorization, same GCP
   client, `access_type=offline&prompt=consent`, scoped to just what's needed — start with
   `drive.readonly` only; add `spreadsheets`/`documents` write scopes later, as a reviewed
   follow-up, once specific `gws` subcommands for the Sheets-write workflows documented in
   `agents-local/AGENTS.md` are actually allowlisted). The refresh token is stored **encrypted**
   in a new table, keyed by the GDG `userId`.
3. **Revised** (was: a slot-invoked `gdg agent workspace-token --sub <gdgSub>` CLI hop — rejected,
   see below): xangi's authz-server (external repo), which already runs as `gdgagent-svc` and
   already resolves each nonce to a Discord user internally, gains a **second socket endpoint**
   alongside the existing `/resolve`, e.g. `/workspace-token?nonce=...`. Stage 07's uid isolation
   makes this the only workable place for this to live: `gdgagent-svc`'s own `gdg login`
   credentials (`/home/gdgagent-svc/.config/gdg/credentials.json`, mode `0600`, owned solely by
   `gdgagent-svc`) are **not** readable by `gdgagent-run-<N>` (the uid the sandboxed agent, and
   therefore `gws.ts`, actually runs as) — a slot-side process spawning `gdg agent
   workspace-token` itself would simply fail to read its own bearer credential. The per-slot authz
   socket (`gdgagent-svc:gdgagent-run-<N>`, mode `0660`) is already the established, working
   boundary for exactly this kind of privileged-broker call (it's what `/resolve` uses today).
   Critically, the endpoint **derives the target user from the nonce itself** — the same nonce
   already used to authenticate the slot to the authz socket for `/resolve` — and never accepts a
   caller-selected user/sub parameter over the wire; a slot process cannot request a token for any
   identity but the one already bound to its own run.
4. `cli/internal/wiki/hooks/acl-core.ts`'s `resolveAuthz()` return type gains `gdgSub: string |
   null`, so `gws.ts` can distinguish "not linked" (fail with guidance) from "linked" (call the
   new endpoint) without an extra round trip.
5. `/opt/gdg-agent/bin/gws` is (like `wk`) a mediator, not the raw binary: a new
   `cli/internal/wiki/hooks/gws.ts`, installed the same way `wk.ts` is. On each invocation it:
   - Re-validates its own argv against a static allowlist (defense in depth beyond the gate).
   - Calls `resolveAuthz()`. If `gdgSub` is missing, it fails with a clear, agent-visible message
     ("connect Google Workspace first: run /login in Discord, then
     accounts.gdgs.jp/settings") — a normal tool-output error, not a crash.
   - If present, calls the authz socket's new `/workspace-token` endpoint (over the same nonce it
     already used for `/resolve`) and gets back a **short-lived Google access token only** — never
     a refresh token, never written to disk, never passed as a `--sub`-style argument it controls.
   - Creates a **fresh, empty, per-invocation** directory and passes it as
     `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` (**correction**: leaving this unset does *not* prevent
     fallback — `gws`'s auth precedence falls through an unset/default config dir to
     `~/.config/gws/credentials.json` or ADC, so an empty config dir must be created and pointed
     at explicitly). It also clears `GOOGLE_WORKSPACE_CLI_CLIENT_ID`,
     `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET`, and `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` from the
     child environment, sets only `GOOGLE_WORKSPACE_CLI_TOKEN=<token>`, and execs the real `gws`
     binary (kept at a fixed, non-PATH path, e.g. `/opt/gdg-agent/bin/gws-bin`) with the original
     argv from a clean cwd. Add a test that plants a `credentials.json`/`.env` in the slot's
     normal `$HOME` and confirms `gws` still ignores it — and that a *failed* vend (endpoint
     error, not-linked) fails closed rather than silently letting `gws` fall back to any
     discoverable credential.
6. The authz-server's `/workspace-token` handler is, in turn, a client of a new
   `accounts.gdgs.jp` endpoint. It authenticates to that endpoint using `gdgagent-svc`'s own `gdg
   login` credentials (which it *can* read, since it runs as `gdgagent-svc`) — either by shelling
   out to `gdg agent workspace-token --sub <gdgSub>` (a new Cobra command reusing
   `accounts.go`'s `withAccessToken()` refresh pattern) or calling the endpoint directly; either
   way this call now happens entirely on the privileged side, never inside a slot. The
   `accounts.gdgs.jp` endpoint itself does two checks: the caller's own GDG identity must be the
   specific pre-registered `gdgagent-svc` service account (an allowlist — *not* "any logged-in
   user can mint tokens for anyone"), and the target `gdgSub` must have an active Workspace
   connection. It then does the Google refresh-token-for-access-token exchange server-side and
   returns only the access token.

This keeps the blast radius of a compromised agent slot to "a short-lived, narrowly-scoped token
for one already-opted-in user, obtainable only for that slot's own bound identity," a strictly
smaller exposure than today's always-on shared-account refresh token — but the new token-vending
endpoint and the new authz-socket endpoint are both privileged surfaces and need a rate limit /
audit log (see Risks).

## Concrete changes

Two mirrored trees must stay byte-identical (`.github/scripts/gdg-agent-layout.test.mjs` asserts
this): `scripts/gdg-agent/*` (parent repo) and `agents-local/*` (submodule). Every file below
appears in both unless marked otherwise.

**Undo/replace the old MCP-based design** (from `e513ae7`/`c8e941d`, see note above):
- `agents-local/.cursor/mcp.json` — drop the `google-workspace` server entirely; leave `gdg-index`
  untouched (that one merges in from `config/mcp.json.in` separately and is unrelated).
- `agents-local/config/permissions.json` + `scripts/gdg-agent/config/permissions.json` — currently
  `{"mcpAllowlist": ["google-workspace:search_drive_files"]}`, confirmed dead (nothing reads
  `mcpAllowlist` anywhere in the repo). Repurpose rather than delete: rename to a `gwsAllowlist`
  array of exact `service resource method` (or `service +helper`) triples, and make this the file
  `shell-allowlist.ts`'s new gws path actually loads — gives the allowlist one auditable,
  non-code home instead of leaving the dead key in place.
- `agents-local/config/cli-config.json` + `scripts/gdg-agent/config/cli-config.json` — drop
  `"Mcp(google-workspace, search_drive_files)"`; add `"Shell(gws)"` and
  `"Shell(/opt/gdg-agent/bin/gws)"` (mirrors the existing `wk` entries). **Also required**: both
  files currently set `sandbox.networkAccess: "user_config_only"` with an empty
  `networkAllowlist`, which blocks all outbound network from the sandboxed process — `gws` cannot
  function at all under this as written (it needs to reach Google's Discovery Service and the
  Workspace API hosts for whatever services are actually allowlisted, e.g. `www.googleapis.com`
  for Discovery documents and Drive, `sheets.googleapis.com`, `docs.googleapis.com`). Add the
  minimum set of Google hosts actually needed by the approved `gwsAllowlist` entries, with a
  one-line comment per host explaining why. `networkAllowlist`'s exact matching semantics
  (hostname vs. full URL, port handling) are undocumented Cursor sandbox behavior per
  `docs/agents-local-mvp/07-agent-uid-isolation.md`'s own notes — confirm the working syntax
  empirically during Phase 2, and verify with a test that traffic to a host *not* on the list
  (e.g. a plain `curl` to an arbitrary domain) is still blocked after the allowlist is added.
- `agents-local/lib/install-layout.sh` + `scripts/gdg-agent/install-layout.sh` — remove the
  `bin/google-workspace-mcp` wrapper-generation block; add a `bin/gws` block generating a wrapper
  that execs `node "$AGENT_ROOT/lib/gws.ts" "$@"` (same shape as the existing `bin/wk` block);
  add `gws.ts` to the hook-file copy loop.
- `agents-local/install.sh` + `scripts/install-gdg-agent-host.sh` — remove `ensure_uv()` and its
  call site (no more `uv`/`uvx`); add an `ensure_gws()` step that installs a pinned `gws` release
  (prefer downloading the prebuilt binary + checksum from GitHub Releases over the npm
  postinstall-download indirection, for a simpler trust boundary) to
  `/opt/gdg-agent/bin/gws-bin`.
- `agents-local/lib/apply-ownership.sh` — remove the `.google_workspace_mcp/{credentials,logs}`
  per-slot directory provisioning (no longer needed: tokens are vended per-invocation, never
  persisted).
- `agents-local/setup.sh` — remove the matching `.google_workspace_mcp` dir creation line.
- `agents-local/ENVIRONMENT.md`, `agents-local/AGENTS.md` — rewrite the "google-workspace MCP"
  sections to describe the `gws` mediator + per-user auth model. Keep the Sheets operational notes
  (protected-range/`insertDimension` quirks) since those are Google-API facts independent of the
  auth model — just retarget them at the equivalent `gws sheets` calls once those are allowlisted.
- `agents-local/dev/configure-google-workspace-mcp.sh`,
  `agents-local/dev/open-google-workspace-oauth-tunnel.sh` — delete (no more local browser-redirect
  problem: token vending is server-side now, not device-local). Replace with a Lima-VM script that
  seeds a fake `google_workspace_connections` row / fake token-endpoint response for a test
  identity, so local iteration doesn't require the full OAuth UI each time.
- `docs/agents-local-testing/iam-e2e-runbook.md`,
  `docs/agents-local-testing/cursor-cli-harness-timeout.md` — the added sections describe an OAuth
  E2E test for the old design that was never actually run; supersede with a runbook for the new
  model rather than leaving instructions for a removed integration.
- `.github/scripts/gdg-agent-layout.test.mjs` — replace the ~50 lines of assertions added for the
  old design (mcp.json shape, wrapper content, `permissions.json.mcpAllowlist`, the `Mcp(...)`
  cli-config entry, dev-script existence) with equivalents for the new layout (`bin/gws` wrapper,
  `gwsAllowlist` shape, `Shell(gws)` entries).

**New files:**
- `cli/internal/wiki/hooks/gws.ts` — the mediator (§ design above).
- `cli/internal/wiki/hooks/shell-allowlist.ts` — generalize. Extract the tokenizer/charset/`&&`-
  chaining logic (currently interleaved with the `wk`-specific `isAllowedWk` check) into a
  binary-agnostic core used by both the existing `inspectWkScript` (unchanged behavior) and a new
  `inspectGwsScript`. `inspectGwsScript` validates the tokenized argv against `gwsAllowlist` using
  **exact triple matching** — approving `drive files list` must not implicitly approve
  `drive files emptyTrash` even though `gws`'s command surface is Discovery-driven and not
  statically enumerable (Google could add a new, more dangerous method under an already-approved
  resource at any time; the matcher must never fall back to resource-level wildcards). Also
  explicitly deny `--upload` (local-file exfiltration vector) and any flag outside a small fixed
  set (`--params`, `--json`, `--page-all`, `--page-limit`).
- `cli/internal/wiki/hooks/acl-gate.ts` — in `handleShell`, branch on argv0: `wk` → existing path
  unchanged; `gws` → new `inspectGwsScript` path. Remove `"search_drive_files"` from
  `MCP_ALLOWLIST` (back to `Set(["search"])` for `gdg-index` only).
- `cli/internal/wiki/acl_gate_test.go` — replace the `MCP:search_drive_files` assertion with
  `Shell(gws ...)` cases: approved triple allowed, unapproved triple denied, `--upload` denied,
  piped/subshelled command denied.
- `cli/internal/command/agent_workspace_token.go` — new `gdg agent workspace-token --sub <gdgSub>`
  Cobra command, following `accounts.go`'s `withAccessToken()` pattern for `gdgagent-svc`'s own
  credential refresh, calling a new `AccountsClient` method. **Invoked only by the xangi
  authz-server's `/workspace-token` handler** (which runs as `gdgagent-svc` and can read its
  credential file), never by `gws.ts` or anything running as a slot uid — see the revised token
  flow above.
- `accounts/migrations/00XX_add_google_workspace_connections.sql` — new table, e.g. `userId` (PK,
  FK → `user`), `refreshTokenEncrypted`, `scope`, `connectedAt`, `updatedAt`, `revokedAt`.
  Ciphertext format: versioned AES-GCM, a random 96-bit nonce generated per row (stored alongside
  the ciphertext, never reused), `userId` bound in as authenticated-but-not-encrypted associated
  data (AAD) so a ciphertext can't be copied onto a different user's row, and the AES key held as
  a Wrangler secret with a documented rotation procedure (re-encrypt on next refresh, or a
  one-time migration script) rather than left undecided.
- `accounts/app/routes/oauth.google-workspace.start.ts`,
  `oauth.google-workspace.callback.ts` — the incremental-consent pair, modeled on the existing
  `oauth.google.{start,callback}.ts`'s file shape but **not** its security handling: those wrapper
  routes get CSRF/state protection for free from Better Auth's `signInSocial`, but this pair talks
  to Google directly and must implement the equivalent itself, explicitly:
  - Require an authenticated `accounts.gdgs.jp` session at **both** `start` and `callback` — this
    is an additive action on an existing account, not a sign-in path.
  - Generate a single-use, short-expiry `state` value bound to the current session's `userId` and
    the intended post-connect redirect target; reject the callback if `state` doesn't match a
    live, unconsumed value for that same session (blocks state replay and cross-session/"wrong
    session callback" confusion).
  - Use PKCE (`code_challenge`/`code_verifier`), even though this is a confidential client with a
    stored secret, for defense in depth consistent with the rest of the OIDC surface in this repo.
  - On callback, validate the granted `scope` actually contains what was requested — Google may
    return a narrower grant than asked for; don't silently proceed as if full access was granted.
  - Handle a **missing `refresh_token`** safely: Google omits it on a repeat consent unless
    `prompt=consent` forces a fresh one (already planned), but treat its absence as a hard failure
    with a clear "please try connecting again" message, not a connection recorded without the
    token it needs.
  - Define explicit reconnect (re-consent overwrites the stored row), disconnect (a user-initiated
    action that deletes/revokes the row and calls Google's token revocation endpoint), and
    revocation (what happens to in-flight `gws` calls using an already-vended access token if the
    connection is revoked mid-run — the token remains valid until its own short TTL expires,
    which is an accepted, documented tradeoff, not a gap) behaviors.
  - Add negative tests: state replay, a callback presented to a different session than the one
    that started the flow, a Google error callback (`error=access_denied` etc.), and a callback
    with a narrower-than-requested scope grant.
- `accounts/app/routes/api.agents.google-workspace-token.ts` — the token-vending endpoint used by
  `gdg agent workspace-token`, gated to the pre-registered `gdgagent-svc` service identity.
- A "Connect Google Workspace" affordance somewhere reachable from the signed-in dashboard.

## External prerequisite: `github.com/Harineko0/xangi` (cannot be done from this checkout)

Narrow, specific ask for that repo:
1. In the authz-server's `/resolve` handler, alongside the existing `classes`/`channelAudience`
   computation (which already resolves the linked `sub` from `links.json`), add `gdgSub: string |
   null` to the response — `null` when the Discord user has no `/login` link or it's
   expired/unrefreshable.
2. **New**: add a second endpoint, `/workspace-token?nonce=...`, authenticated the same way
   `/resolve` already is (the per-run nonce). The handler resolves `gdgSub` for that nonce
   *internally* (reusing the same lookup `/resolve` does) — it must never accept a caller-supplied
   user/sub parameter, since the whole point is that a slot can only ever request a token for the
   identity already bound to its own run. If `gdgSub` is null, return a clear "not connected"
   response. Otherwise, authenticated as `gdgagent-svc`'s own `gdg login` identity (which the
   authz-server process already has read access to, running as `gdgagent-svc`), call the new
   `accounts.gdgs.jp` token-vending endpoint (this repo, above) — either by shelling out to `gdg
   agent workspace-token --sub <gdgSub>` or calling the HTTP endpoint directly — and return only
   the resulting short-lived Google access token. Never log, cache to disk, or forward the
   underlying Google refresh token; it never leaves `accounts.gdgs.jp`.
3. No change to `links.json`'s stored scopes — it stays login-only; Workspace auth is entirely an
   `accounts.gdgs.jp` concern (this repo, above).
4. Whatever currently gates on "empty classes → refuse" should *not* also require `gdgSub` — a
   user with wiki-editing roles but no Workspace connection should still be able to do everything
   except `gws` calls; `gws.ts` itself is what surfaces the "please connect" message.
5. No change to `XANGI_AUTHZ_NONCE`/`XANGI_AUTHZ_SOCKET` env plumbing or per-slot socket
   isolation — both `gdgSub` and the new endpoint ride the existing nonce-authenticated channel.
6. Extend the authz-server's test coverage for both the new `gdgSub` field and the
   `/workspace-token` endpoint (including: a nonce with no linked account, and confirming the
   endpoint never trusts a client-supplied identity).

## Suggested phases

Each phase has its own detailed plan file:

1. [`accounts/` linking + token vending](01-accounts-workspace-link.md) — migration,
   `oauth.google-workspace.*` routes, `api.agents.google-workspace-token.ts`, dashboard
   affordance. Independently testable with Vitest + a real/sandboxed Google test-mode OAuth
   client; doesn't touch `agents-local` or xangi.
2. [`agents-local` Shell allowlist + `gws` install](02-agents-local-shell-allowlist.md) —
   `gws.ts`, generalized `shell-allowlist.ts`, `acl-gate.ts` dispatch, install-script changes
   (both mirrored trees), config changes (both mirrored trees), layout-test updates. Testable
   standalone by having `gws.ts` read a token from an env var directly, short-circuiting the
   broker hop while Phase 1/3 are still in flight.
3. [Broker wiring, end to end](03-broker-token-vending.md) — the new `gdg agent workspace-token`
   Cobra command; land the xangi `gdgSub` field and the new `/workspace-token` authz-socket
   endpoint (both tracked as external dependencies, invoked only from the privileged
   `gdgagent-svc`-uid authz-server, never from a slot); flip `gws.ts` from the Phase-2
   short-circuit to the real `resolveAuthz()` → `gdgSub` → authz-socket `/workspace-token` path.
4. [Lima VM dev loop + docs](04-lima-dev-loop-and-docs.md) — fake-connection seeding script for
   local iteration, rewritten `ENVIRONMENT.md`/`AGENTS.md`/`iam-e2e-runbook.md`.

## Verification

- **Unit**: extend `cli/internal/wiki/acl_gate_test.go`; add a `shell-allowlist.test.ts` (none
  exists today) covering approved/unapproved `gws` triples, `--upload` denial, malformed-command
  denial, and a regression check that `wk` behavior is unchanged.
- **Layout mirroring**: extend `.github/scripts/gdg-agent-layout.test.mjs` with the new `bin/gws`
  wrapper and `gwsAllowlist` shape — this is the existing CI gate that already fails the build on
  any drift between the two mirrored trees, so it's the natural place to catch a missed edit.
- **Phase 1 standalone**: Vitest against the new `accounts/` routes; a manual browser consent run
  against a real Google test-mode OAuth client, confirming the stored refresh token round-trips
  to an access token via the vending endpoint.
- **Phase 2 standalone**: with `gws.ts`'s token source short-circuited to an env var, run the
  existing Lima VM harness pattern (`docs/agents-local-testing/iam-e2e-runbook.md`) and confirm an
  approved `gws drive files list` Shell call executes and an unapproved one is denied with the
  expected `agent_message`.
- **Phase 3 E2E**: the real, still-never-run OAuth E2E — a live Discord message from a test user
  who has done `/login` *and* "Connect Google Workspace," through the full chain, against a real
  test Drive file. Also test the unlinked case explicitly (no `/login`, or `/login` without a
  Workspace connection) to confirm the graceful error path, not a crash.

## Open risks (do not paper over)

- **Discovery drift**: `gws`'s command tree is fetched live from Google's Discovery Service
  (cached 24h) — an approved resource could gain a new, more dangerous sibling method without any
  code change here. The exact-triple-match design defends against this only if the matcher is
  truly exact-string and never falls back to resource-level wildcards; cover this with an explicit
  test case, not just a comment.
- **Unverified-app scope cap**: Google caps unverified (testing-mode) OAuth apps at ~25 scopes
  total. Start with `drive.readonly` only; add write scopes as a separate, reviewed step tied to
  specific new allowlist entries, not speculatively.
- **The token-vending endpoint is a new privileged surface**: if `gdgagent-svc`'s own `gdg login`
  credentials leak, an attacker can mint Workspace tokens for any user who opted in — a strictly
  smaller blast radius than today's always-on shared refresh token, but not zero. Add a rate limit
  and an audit log on `api.agents.google-workspace-token.ts`.
- **Refresh-token encryption at rest**: resolved as a concrete decision rather than left open —
  see the `google_workspace_connections` entry under "New files" above (versioned AES-GCM,
  per-row random nonce, `userId` as AAD, Wrangler-secret key, documented rotation). Don't copy
  `wiki/`'s `discordOauthTokens.refreshToken` plaintext-in-D1 precedent; Workspace scopes are more
  sensitive than a Discord guild-list token.
- **Resolved**: the earlier draft had `gws.ts` (running as the slot uid `gdgagent-run-<N>`) either
  spawn `gdg agent workspace-token` itself or read `gdgagent-svc`'s credentials directly — both
  are impossible under Stage 07's uid isolation, since `~/.config/gdg/credentials.json` is
  `gdgagent-svc:gdgagent-svc 0600` and not readable by a slot uid. The design above moves that
  call to the xangi authz-server's new `/workspace-token` endpoint, which already runs as
  `gdgagent-svc` and already owns the per-slot nonce-to-identity resolution — no new privilege
  boundary is crossed, and the endpoint resolves the target user from the nonce itself rather than
  trusting a caller-supplied `--sub`, closing the confused-deputy gap a slot-supplied parameter
  would otherwise open.
