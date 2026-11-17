# Incident: `gws drive files list` — ACL gate fixed, `gdg agent workspace-token` 401 root-caused

## Context

A user report — "agents cannot run `gws drive files list`, blocked by ACL, error `ACL gate
blocked a tool call.`" — led to four independent bugs on `mincra-srv` (the live `agents-local`
host) and in the `accounts` OAuth provider, fixed in order. The first three are fully resolved.
The fourth (§4) had its root cause confirmed and fixed in the `accounts` package in this repo;
what remains is deploying that fix and a few host/release-level follow-ups (see "Suggested next
steps"). This doc records the chain so the fix isn't re-diagnosed from scratch.

## 1. Fixed: ACL gate tokenizer rejected legitimate `gws` commands

`cli/internal/wiki/hooks/shell-allowlist.ts`'s `Shell(gws ...)` grammar (see
[02-agents-local-shell-allowlist.md](02-agents-local-shell-allowlist.md)) had two real gaps, both
hit by the same real-world command:

```bash
gws drive files list --params '{"q": "mimeType='\''application/vnd.google-apps.document'\'' and trashed=false", "fields": "files(id,name,modifiedTime,owners)", "pageSize": 50}' --format table 2>&1
```

- A trailing `2>&1` (merging stderr into stdout — the standard way an agent captures full output)
  was denied because `>` and a lone `&` are forbidden metacharacters everywhere in the command,
  with no carve-out for fd duplication.
- Google Drive's `q` query syntax requires single quotes around string literals
  (`mimeType='application/vnd.google-apps.document'`), so a `--params` JSON blob embedding a `q`
  value needs the standard POSIX `'...'\''...'` idiom to embed a literal quote inside a
  single-quoted shell argument. The tokenizer read each quoted/bare fragment as a separate argv
  element instead of concatenating adjacent fragments into one shell word, so it choked on the
  bare `\` that idiom requires.

Also separately widened `GWS_ALLOWED_FLAGS` to include `--format`, `--dry-run`, `--page-delay`,
`--api-version` (safe, output/metadata-only, no file I/O, no new OAuth scope — `gws-bin --help`
lists them; `--upload*`, `-o`/`--output`, `--sanitize` stay excluded on purpose) and made flag
matching split on `=` so clap's `--flag=value` form works, not just `--flag value`.

**Fix commits** (gdgjp main): `c924ef4`, `1e2d864`. Root-caused via a temporary, decision-neutral
diagnostic added in `af5e71d` (dumps `HOME`, the resolved `gwsAllowlist`, and the raw command to a
unique world-readable `/tmp` file on every `gws` Shell call, no sudo needed to read it) — **this
diagnostic is still in `acl-gate.ts` and should be reverted once the issue below is resolved.**

Verified: the exact command above, replayed through the deployed hook, returns
`{"permission":"allow"}`, and the live agent confirmed `gws` started executing.

## 2. Host workaround: `install.sh` never updated an already-installed `gdg`

`ensure_gdg_system()` in `agents-local/install.sh` only ever installed `/usr/local/bin/gdg` the
*first* time; every subsequent run (`--reload-config` included) silently skipped it once the file
existed. This host was frozen on `gdg` `0.1.4` (installed 2026-08-20) with no `agent` command
group at all.

**Fix** (uncommitted in the `agents-local` submodule alongside pre-existing local changes,
commit it separately there): `ensure_gdg_system()` now runs `/usr/local/bin/gdg update -y` when
the binary already exists, instead of a no-op.

## 3. Host workaround: no released `gdg` has `agent workspace-token`

Running `gdg update` picked up `0.1.7` — still no `agent` command. `cli/internal/command/
agent_workspace_token.go` (commit `e501710`, "wire real per-Discord-user Workspace token
vending") is on `main` but **not contained in any tag** (`cli/v0.1.7` is the latest and predates
it): `git tag --contains e501710` returns nothing.

**Workaround in place on `mincra-srv` right now**: `/usr/local/bin/gdg` was replaced with a local
`go build ./cmd/gdg` from this checkout's HEAD, reporting version `1e2d864-local` (deliberately
non-official-looking). **This will be silently reverted back to the stale `0.1.7` the next time
`gdg update` runs** (which now happens on every `install.sh` run, per fix #2) — the real fix is
cutting and publishing an official `gdg` release that includes `agent_workspace_token.go`.

## 4. Fixed: `gdg agent workspace-token` got 401 from `accounts.gdgs.jp`

With the local build in place, `gdg agent workspace-token --sub <sub>` runs but the accounts API
call itself fails:

```
Error: GDG Japan Accounts request failed: 401 Unauthorized: unauthorized
```

Reproduced directly, bypassing xangi/gws entirely:

```bash
sudo -u gdgagent-svc HOME=/home/gdgagent-svc /usr/local/bin/gdg agent workspace-token --sub <sub>
```

### What's been ruled out

- **Not stale credentials**: `gdgagent-svc`'s `~/.config/gdg/credentials.json` mtime advanced
  (`01:10` → `03:37` across two attempts), proving `withAccessToken()`'s refresh-on-401 path (in
  `agent_workspace_token.go`) *did* run, `oauth.Refresh()` succeeded, and the refreshed
  credentials *were* saved. The retried call, using the brand-new access token, got the exact
  same 401 — so this isn't an expiry problem.
- **Not a `client_id` mismatch**: both sides agree on `"gdg-cli"` — `cli/internal/oauth/oauth.go`
  (`clientID = "gdg-cli"`) and `accounts/app/lib/oauth-clients.server.ts`
  (`CLI_CLIENT_ID = "gdg-cli"`, used in `requireCliTokenUser`'s lookup).
- **Not the `AGENTS_SERVICE_ACCOUNT_USER_ID` identity check**: that comparison
  (`api.agents.google-workspace-token.ts` line 38) runs *after* `requireCliTokenUser` resolves a
  caller, and returns 403 `forbidden` on a mismatch — a different status/body than what's
  observed. The failure is in caller resolution itself, before identity is even checked. (The
  user did point `AGENTS_SERVICE_ACCOUNT_USER_ID` at their own account as a separate, valid fix
  for a *different*, not-yet-reached problem — see "Also worth fixing" below — but it correctly
  didn't change this symptom.)

### Root cause, confirmed

`requireCliTokenUser` (`accounts/app/lib/oauth-clients.server.ts`) did a raw D1 query:

```sql
SELECT userId, scopes FROM oauthAccessToken
WHERE token = ? AND clientId = ? AND expiresAt > ? AND userId IS NOT NULL
```

binding the bearer token **as received, in plaintext**. Reading the installed
`@better-auth/oauth-provider@1.6.23` source confirmed it stores access tokens **hashed**:
`accounts/app/lib/auth.server.ts` calls `oauthProvider({...})` without overriding `storeTokens`,
so the plugin's default `storeTokens: "hashed"` applies. Tokens are written via
`storeToken("hashed", token, "access_token")`, which hashes with unpadded base64url-encoded
SHA-256 of the raw token. The raw-token comparison in `requireCliTokenUser` could therefore
**never** match — for anyone, not just `gdgagent-svc` — which is exactly the observed symptom (a
fresh refresh, then the same 401).

The same codebase already had the correct pattern in `accounts/app/routes/api.users.search.ts`
(a `hashAccessToken` helper hashing the bearer token before the same raw-SQL shape), and
`oauth-clients.server.ts` already had a `sha256Base64Url` helper doing the identical hash (used
only for client secrets). A sibling instance of the same bug also existed in
`accounts/app/routes/api.cli.logout.ts`'s token lookup and delete.

**Fix**: `requireCliTokenUser` now hashes the bearer token with `sha256Base64Url` before binding
it into the query, and `api.cli.logout.ts` got the same fix with a local `hashAccessToken` helper
mirroring `api.users.search.ts`'s. Tests in `oauth-clients-access.server.test.ts` were updated to
assert the hashed token is bound, not the raw one.

**This is not yet deployed or verified end-to-end.** Deploying `accounts` and re-running
`gdg agent workspace-token --sub <sub>` on `mincra-srv` is the remaining confirmation step.

### Also worth fixing (lower priority, separate from the 401)

`gdgagent-svc`'s `~/.config/gdg/credentials.json` was, until today, entirely absent — it was
created for the first time at `01:10:00` during one of this investigation's `install.sh` runs.
Its size and shape (124 bytes, two 32-char opaque tokens) exactly match the operator's own
`~/.config/gdg/credentials.json` (unchanged since `2026-08-20`), and `ensure_svc_gdg_login()` in
`install.sh` has exactly this fallback: *copy the operator's own credentials to `gdgagent-svc`
when no TTY is available for a real device-flow login*. The design intent
(`agent_workspace_token.go`'s doc comment: *"Only gdgagent-svc's own gdg login credentials can
call this"*) is for `gdgagent-svc` to have its **own** dedicated service-account identity, not a
copy of whichever operator happened to run `install.sh` without a TTY. The user worked around this
for now by pointing `AGENTS_SERVICE_ACCOUNT_USER_ID` at their own account, which is a reasonable
stopgap but should be revisited once a real service-account identity exists.

## Suggested next steps, in order

1. Deploy the `accounts` fix (§4) and re-run `gdg agent workspace-token --sub <sub>` on
   `mincra-srv` to confirm the 401 is gone end-to-end.
2. Cut and publish a real `gdg` CLI release containing `agent_workspace_token.go`, then replace
   the `mincra-srv` stopgap build with it (`sudo gdg update` will pick it up automatically once
   released).
3. Decide on `gdgagent-svc`'s long-term identity (§4, "Also worth fixing") instead of leaning on
   `AGENTS_SERVICE_ACCOUNT_USER_ID` pointing at an operator's personal account.
4. Revert the temporary diagnostic in `cli/internal/wiki/hooks/acl-gate.ts` (`af5e71d`,
   `debugGwsSnapshot`) now that §4 is root-caused and no longer needs it.
