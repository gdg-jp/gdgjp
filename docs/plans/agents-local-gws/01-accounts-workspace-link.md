# Phase 1 — `accounts/` Google Workspace linking + token vending

Part of [the `gws` migration plan](plan.md). Independently shippable/testable: this phase touches
only `accounts/` and does not depend on `agents-local` or xangi changes landing first.

## Goal

Let a GDG account holder additively grant Google Workspace API access (separate from, and on top
of, the existing "Continue with Google" *login*), store the resulting refresh token encrypted, and
expose a privileged, narrowly-gated endpoint that exchanges it for short-lived access tokens on
request — the endpoint Phase 3's broker will call. Nothing in this phase talks to `agents-local`,
`gws`, or xangi.

## Background (from the investigation in `plan.md`)

- `accounts/` has **no Drizzle `schema.ts`** — unlike `wiki/`, it's raw-SQL-migrations only
  (`accounts/migrations/000N_*.sql` → generated `accounts/schema.sql`; per the root `CLAUDE.md`,
  edit migrations, never the generated dump). The new table is a new numbered migration; new
  routes query D1 directly the way `accounts/app/lib/oauth-clients.server.ts` and neighboring
  `*.server.ts` files already do.
- `accounts/app/lib/auth.server.ts` (confirmed by `accounts/CLAUDE.md` as the single source of
  truth for auth) already has a Google sign-in via Better Auth's `signInSocial` with
  `provider: "google"` (`accounts/app/routes/oauth.google.start.ts`) — but it's **login-scoped
  only**: no `access_type=offline`, no extra scopes, and it's Better Auth's own `account` table.
  Do **not** extend that table or flow — a second consent through the same social-provider path
  risks silently clobbering the login-linked row's tokens/scope with no clean "keep login, add
  broader scopes" semantics.
- Google's *incremental authorization* (a second, additive consent on an already-connected app,
  via a direct `accounts.google.com/o/oauth2/v2/auth` redirect with
  `access_type=offline&prompt=consent&include_granted_scopes=true`) is the right primitive here,
  and it reuses the **same** GCP OAuth client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, already a
  Wrangler secret in `accounts/`) — no second GCP client needed.
- The new callback URL needs registering as a redirect URI directly on that OAuth client in the
  **Google Cloud Console** (or via `gcloud`) — this is a Google-side setting, **not**
  `accounts.gdgs.jp`'s own `/admin/seed-clients` (which only seeds GDG's downstream
  relying-party OIDC clients, e.g. the `AGENTS_CLIENT_ID`-style per-app entries for
  tinyurl/img/scheduler/etc. — unrelated to this change; don't run it for this).

## Concrete changes

**New migration**: `accounts/migrations/00XX_add_google_workspace_connections.sql`
- Table `google_workspace_connections`: `userId` (PK, FK → `user`), `refreshTokenEncrypted`,
  `scope`, `connectedAt`, `updatedAt`, `revokedAt`.
- Ciphertext format (decide this now, don't defer): versioned AES-GCM, a random 96-bit nonce
  generated per row (stored alongside the ciphertext, never reused), `userId` bound in as
  authenticated-but-not-encrypted associated data (AAD) so a ciphertext can't be copied onto a
  different user's row, and the AES key held as a Wrangler secret with a documented rotation
  procedure (re-encrypt on next refresh, or a one-time migration script).

**New routes**: `accounts/app/routes/oauth.google-workspace.start.ts`,
`oauth.google-workspace.callback.ts` — modeled on the existing `oauth.google.{start,callback}.ts`
file *shape* but **not** its security handling: those wrapper routes get CSRF/state protection for
free from Better Auth's `signInSocial`; this pair talks to Google directly and must implement the
equivalent itself, explicitly:
- Require an authenticated `accounts.gdgs.jp` session at **both** `start` and `callback` — this is
  an additive action on an existing account, not a sign-in path.
- Generate a single-use, short-expiry `state` value bound to the current session's `userId` and
  the intended post-connect redirect target; reject the callback if `state` doesn't match a live,
  unconsumed value for that same session (blocks state replay and cross-session/"wrong session
  callback" confusion).
- Use PKCE (`code_challenge`/`code_verifier`), even though this is a confidential client with a
  stored secret, for defense in depth consistent with the rest of the OIDC surface in this repo.
- On callback, validate the granted `scope` actually contains what was requested — Google may
  return a narrower grant than asked for; don't silently proceed as if full access was granted.
- Handle a **missing `refresh_token`** safely: Google omits it on a repeat consent unless
  `prompt=consent` forces a fresh one (already planned), but treat its absence as a hard failure
  with a clear "please try connecting again" message, not a connection recorded without the token
  it needs.
- Define explicit reconnect (re-consent overwrites the stored row), disconnect (a user-initiated
  action that deletes/revokes the row and calls Google's token revocation endpoint), and
  revocation (an already-vended access token from Phase 3 remains valid until its own short TTL
  expires even if the connection is revoked mid-run — an accepted, documented tradeoff, not a gap)
  behaviors.
- Add negative tests: state replay, a callback presented to a different session than the one that
  started the flow, a Google error callback (`error=access_denied` etc.), and a callback with a
  narrower-than-requested scope grant.

**New endpoint**: `accounts/app/routes/api.agents.google-workspace-token.ts` — the token-vending
endpoint. Two checks, both required: the caller's own GDG identity must be the specific
pre-registered `gdgagent-svc` service account (an allowlist — *not* "any logged-in user can mint
tokens for anyone"), and the target user (`sub`/`userId`, passed by the caller — this endpoint's
caller is a trusted service in Phase 3, not a sandboxed slot, so a caller-supplied target here is
fine and is a different trust boundary than the slot-facing socket in Phase 3) must have an active
row in `google_workspace_connections`. It then does the Google
refresh-token-for-access-token exchange server-side and returns **only** the resulting short-lived
access token — never the refresh token. Add a rate limit and an audit log on this route: if
`gdgagent-svc`'s own credentials leak, this is the endpoint that would let an attacker mint
Workspace tokens for any user who opted in.

**UI**: a "Connect Google Workspace" affordance reachable from the signed-in dashboard, showing
connection status and a disconnect action.

**Scope choice**: start with `drive.readonly` only. Google caps unverified (testing-mode) OAuth
apps at ~25 scopes total — add `spreadsheets`/`documents` write scopes later, as a separate,
reviewed step once specific `gws` subcommands for those workflows are actually allowlisted in
Phase 2/3, not speculatively now.

## Verification

- Vitest against the new routes: happy path, and the negative-test list above.
- Manual browser consent run against a real Google test-mode OAuth client, confirming the stored
  (encrypted) refresh token round-trips to a valid access token via the vending endpoint.
- Confirm the vending endpoint rejects a caller that isn't the pre-registered `gdgagent-svc`
  identity, and rejects a target user with no connection row.

## Out of scope for this phase

Anything touching `agents-local`, `cli/internal/wiki/hooks/`, the `gdg` CLI, or xangi — those are
Phases 2 and 3.
