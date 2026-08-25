# Phase 2 — `agents-local` Shell allowlist + `gws` install

Part of [the `gws` migration plan](plan.md). Independently testable, decoupled from Phase 1: build
`gws.ts` with its token source short-circuited to an env var (`GOOGLE_WORKSPACE_CLI_TOKEN` set
directly by the test harness) rather than the real authz-socket call, so this phase can be
verified before Phase 1's linking flow or Phase 3's broker endpoint exist.

## Goal

Replace `google-workspace-mcp`'s MCP registration and install path with `gws` invoked as a
gated Shell command: a generalized Shell allowlist that accepts a second binary (`gws`) alongside
`wk`, each independently scoped, plus the install/provisioning changes to fetch and place `gws`
instead of `uvx workspace-mcp`.

## Before starting

Two commits already exist on `main` in both the parent repo (`e513ae7`) and the `agents-local`
submodule (`c8e941d`) that built the *old* MCP-based design this phase undoes (wrapper script
reading a slot env file, ACL allowlist entries for `search_drive_files`, Lima-VM OAuth-tunnel dev
scripts). This phase's file list below is written as a revert-and-replace of those commits —
confirm they're still the current state before starting, don't blindly diff against a stale
assumption.

Two mirrored trees must stay byte-identical (`.github/scripts/gdg-agent-layout.test.mjs` asserts
this): `scripts/gdg-agent/*` (parent repo) and `agents-local/*` (submodule). Every file below
appears in both unless marked otherwise.

## Concrete changes

**Undo/replace the old MCP-based design:**
- `agents-local/.cursor/mcp.json` — drop the `google-workspace` server entirely; leave `gdg-index`
  untouched (merges in separately from `config/mcp.json.in`, unrelated).
- `agents-local/config/permissions.json` + `scripts/gdg-agent/config/permissions.json` — currently
  `{"mcpAllowlist": ["google-workspace:search_drive_files"]}`, confirmed dead (nothing reads
  `mcpAllowlist` anywhere). Repurpose rather than delete: rename to a `gwsAllowlist` array of exact
  `service resource method` (or `service +helper`) triples, and make this the file
  `shell-allowlist.ts`'s new gws path actually loads — one auditable, non-code home for the
  allowlist instead of a dead key.
- `agents-local/config/cli-config.json` + `scripts/gdg-agent/config/cli-config.json` — drop
  `"Mcp(google-workspace, search_drive_files)"`; add `"Shell(gws)"` and
  `"Shell(/opt/gdg-agent/bin/gws)"` (mirrors the existing `wk` entries). **Also required**: both
  files set `sandbox.networkAccess: "user_config_only"` with an empty `networkAllowlist`, which
  blocks all outbound network from the sandboxed process — `gws` cannot function at all under this
  as written (it needs Google's Discovery Service and the Workspace API hosts for whatever
  services are actually allowlisted, e.g. `www.googleapis.com` for Discovery documents and Drive,
  `sheets.googleapis.com`, `docs.googleapis.com`). Add the minimum set of Google hosts needed by
  the approved `gwsAllowlist` entries, with a one-line comment per host explaining why.
  `networkAllowlist`'s exact matching semantics (hostname vs. full URL, port handling) are
  undocumented Cursor sandbox behavior per `docs/agents-local-mvp/07-agent-uid-isolation.md`'s own
  notes — confirm the working syntax empirically, and verify with a test that traffic to a host
  *not* on the list (e.g. a plain `curl` to an arbitrary domain) is still blocked afterward.
- `agents-local/lib/install-layout.sh` + `scripts/gdg-agent/install-layout.sh` — remove the
  `bin/google-workspace-mcp` wrapper-generation block; add a `bin/gws` block generating a wrapper
  that execs `node "$AGENT_ROOT/lib/gws.ts" "$@"` (same shape as the existing `bin/wk` block); add
  `gws.ts` to the hook-file copy loop.
- `agents-local/install.sh` + `scripts/install-gdg-agent-host.sh` — remove `ensure_uv()` and its
  call site (no more `uv`/`uvx`); add an `ensure_gws()` step that installs a pinned `gws` release
  (prefer downloading the prebuilt binary + checksum from GitHub Releases over the npm
  postinstall-download indirection, for a simpler trust boundary) to `/opt/gdg-agent/bin/gws-bin`.
- `agents-local/lib/apply-ownership.sh` — remove the `.google_workspace_mcp/{credentials,logs}`
  per-slot directory provisioning (no longer needed: tokens are vended per-invocation in Phase 3,
  never persisted).
- `agents-local/setup.sh` — remove the matching `.google_workspace_mcp` dir creation line.
- `.github/scripts/gdg-agent-layout.test.mjs` — replace the assertions added for the old design
  (mcp.json shape, wrapper content, `permissions.json.mcpAllowlist`, the `Mcp(...)` cli-config
  entry, dev-script existence) with equivalents for the new layout (`bin/gws` wrapper,
  `gwsAllowlist` shape, `Shell(gws)` entries).

**New files:**
- `cli/internal/wiki/hooks/gws.ts` — the mediator that `/opt/gdg-agent/bin/gws` execs (like `wk`,
  not the raw binary). For this phase, its token-acquisition step is a stub reading
  `GOOGLE_WORKSPACE_CLI_TOKEN` from its own environment directly (Phase 3 replaces this with the
  real `resolveAuthz()` → authz-socket call). What it must always do, regardless of token source:
  - Re-validate its own argv against the static allowlist (defense in depth beyond the gate).
  - Create a **fresh, empty, per-invocation** directory and pass it as
    `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` — leaving this unset does **not** prevent credential
    fallback (`gws`'s auth precedence falls through an unset/default config dir to
    `~/.config/gws/credentials.json` or ADC), so an empty dir must be created and pointed at
    explicitly.
  - Clear `GOOGLE_WORKSPACE_CLI_CLIENT_ID`, `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET`, and
    `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` from the child environment; set only
    `GOOGLE_WORKSPACE_CLI_TOKEN=<token>`.
  - Exec the real `gws` binary (kept at a fixed, non-PATH path, `/opt/gdg-agent/bin/gws-bin`) with
    the original argv, from a clean cwd.
  - Add a test that plants a `credentials.json`/`.env` in the slot's normal `$HOME` and confirms
    `gws` still ignores it — and that a failed/absent token source fails closed rather than
    silently letting `gws` fall back to any discoverable credential.
- `cli/internal/wiki/hooks/shell-allowlist.ts` — generalize. Extract the tokenizer/charset/`&&`-
  chaining logic (currently interleaved with the `wk`-specific `isAllowedWk` check) into a
  binary-agnostic core used by both the existing `inspectWkScript` (unchanged behavior) and a new
  `inspectGwsScript`. `inspectGwsScript` validates the tokenized argv against `gwsAllowlist` using
  **exact triple matching** — approving `drive files list` must not implicitly approve
  `drive files emptyTrash` even though `gws`'s command surface is Discovery-driven and not
  statically enumerable (Google could add a new, more dangerous method under an already-approved
  resource at any time; the matcher must never fall back to resource-level wildcards). Also
  explicitly deny `--upload`/`--upload-content-type` (local-file exfiltration vector), `-o`/
  `--output` (local-file write), and `--sanitize` (needs a `cloud-platform` OAuth scope not
  currently granted), and any flag outside a small fixed set of safe, no-file-I/O,
  no-new-scope output/metadata flags: `--params`, `--json`, `--page-all`, `--page-limit`,
  `--format`, `--dry-run`, `--page-delay`, `--api-version`. Flags are matched by name only — a
  `--flag=value` token (clap, gws-bin's arg parser, accepts this form same as `--flag value`) is
  split on the first `=` before the allowlist check, so it isn't rejected as an unrecognized flag.
  A trailing `[ \t]+2>&1[ \t]*$` (merging stderr into stdout — the standard way an agent captures
  full output, not a redirect to/from a file) is stripped before grammar validation. The tokenizer
  also concatenates adjacent quoted/bare fragments into one shell word — matching real shell
  behavior — and recognizes the one POSIX idiom for embedding a literal `'` inside a single-quoted
  value (`'...'\''...'`, i.e. close-quote, backslash-escaped quote, reopen-quote) as a single
  escaped-quote token; this is required because Google Drive's `q` query syntax itself uses single
  quotes around string literals (e.g. `mimeType='application/vnd.google-apps.document'`), so a
  `--params` JSON blob embedding a `q` value needs it. No other backslash use is permitted, and the
  boundary check for the `&&` chain separator runs before each fragment is read, so `&&` can never
  be smuggled through the escape into looking like part of a word's content (`acl_gate_test.go` /
  `shell-allowlist.test.ts` assert this directly, alongside the still-forbidden bare cases: a
  dangling or non-quote-escaping backslash, and `;`/`&&`/etc. immediately adjacent to a quoted
  fragment).
- `cli/internal/wiki/hooks/acl-gate.ts` — in `handleShell`, branch on argv0: `wk` → existing path
  unchanged; `gws` → new `inspectGwsScript` path. Remove `"search_drive_files"` from
  `MCP_ALLOWLIST` (back to `Set(["search"])` for `gdg-index` only).
- `cli/internal/wiki/acl_gate_test.go` — replace the `MCP:search_drive_files` assertion with
  `Shell(gws ...)` cases: approved triple allowed, unapproved triple denied, `--upload` denied,
  piped/subshelled command denied.

## Verification

- **Unit**: extend `cli/internal/wiki/acl_gate_test.go`; add a `shell-allowlist.test.ts` (none
  exists today) covering approved/unapproved `gws` triples, `--upload` denial, malformed-command
  denial, and a regression check that `wk` behavior is unchanged.
- **Layout mirroring**: extend `.github/scripts/gdg-agent-layout.test.mjs` with the new `bin/gws`
  wrapper and `gwsAllowlist` shape — this is the existing CI gate that already fails the build on
  any drift between the two mirrored trees, the natural place to catch a missed edit.
- **Standalone**: with `gws.ts`'s token source short-circuited to an env var, run the existing
  Lima VM harness pattern (`docs/agents-local-testing/iam-e2e-runbook.md`) and confirm an approved
  `gws drive files list` Shell call executes and an unapproved one is denied with the expected
  `agent_message`. Also confirm outbound traffic to a non-allowlisted host is still blocked.

## Out of scope for this phase

The real per-user token flow (authz-socket `/workspace-token` call, `gdg agent workspace-token`,
xangi's `gdgSub` field) — Phase 3. Rewriting `ENVIRONMENT.md`/`AGENTS.md` prose and the Lima-VM
dev scripts — Phase 4.
