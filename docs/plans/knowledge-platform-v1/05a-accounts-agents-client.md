# Stage 5a — accounts OAuth client for agent.gdgs.jp

## Context — Background and Repository State

agent.gdgs.jp (Stage 5) links each Google Chat / Discord user to a GDG account and calls the Wiki API with
that person's access token. Before any of that can be built, accounts.gdgs.jp must issue an OAuth client for
it. This stage adds that client and nothing else.

**Dependencies:** none. Can run in parallel with 5b and 5c.
**Blocks:** Stage 5d (account linking) cannot be tested end to end until this is deployed *and* reseeded.
**Target workspace:** `accounts/` only.

Stage overview: [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md).

### Required reading

- `CLAUDE.md` (root) — "When an Accounts OAuth client secret, ID, or redirect URI changes, reseed its client
  data through `/admin/seed-clients` before testing the integration."
- `accounts/CLAUDE.md` — bindings and conventions for this workspace.

### Existing implementations to reuse

The client registration path is fully built. This stage adds one entry to it; do not write new seeding code.

- `accounts/app/lib/seed-clients.server.ts` — `collectSpecs()` builds client specs from `[vars]`, and the
  seeding routine upserts them. It already sets `requirePKCE = 1`, `public = 0`, `type = 'web'`,
  `tokenEndpointAuthMethod = 'client_secret_basic'`, `grantTypes = ["authorization_code", "refresh_token"]`,
  `responseTypes = ["code"]`, scopes `["openid", "email", "profile", "offline_access", CHAPTERS_SCOPE]`, and
  hashes the secret with `sha256Base64Url`.
- `accounts/app/routes/admin.seed-clients.tsx` — `POST /admin/seed-clients`, admin-only, idempotent.
- `accounts/app/lib/auth.server.ts` — `buildAuth()` holds `trustedClientIds`, which feeds the consent-skip path.
- The **SNS client is the closest precedent**: `SNS_CLIENT_ID` / `SNS_CLIENT_SECRET` / `SNS_REDIRECT_URLS`.
  Mirror it exactly.

### Already-resolved facts (do not re-investigate)

These were verified against `@better-auth/oauth-provider@1.6.23` as configured in this repo. Stage 5d depends
on them; record them, do not re-derive them.

| Fact | Value |
|---|---|
| PKCE | `S256` only, and mandatory for seeded clients (`requirePKCE = 1`, `public = 0`). `plain` is not accepted. |
| Refresh tokens | Issued. `accessTokenExpiresIn` 3600 s, `refreshTokenExpiresIn` 2592000 s (30 days). |
| Authorize | `https://accounts.gdgs.jp/api/auth/oauth2/authorize` |
| Token | `https://accounts.gdgs.jp/api/auth/oauth2/token` |
| UserInfo | `https://accounts.gdgs.jp/api/auth/oauth2/userinfo` |
| Revoke | `https://accounts.gdgs.jp/api/auth/oauth2/revoke` (no short compat alias, unlike authorize/token/userinfo) |
| Scopes to request | `openid email profile offline_access https://gdgs.jp/scopes/chapters` |
| Chapter claims | `https://gdgs.jp/claims/chapters`, `https://gdgs.jp/claims/is_admin` — only returned when the chapters scope is granted |

## Design

### 1. Configuration variables

Add to `[vars]` in `accounts/wrangler.toml`, alongside the existing `TINYURL_*` / `WIKI_*` / `IMG_*` /
`SCHEDULER_*` / `SNS_*` pairs:

```toml
AGENTS_CLIENT_ID = "agents"
AGENTS_REDIRECT_URLS = "https://agent.gdgs.jp/auth/callback"
```

Add `AGENTS_CLIENT_SECRET=` to `accounts/.dev.vars.example`. The production secret is stored with
`wrangler secret put AGENTS_CLIENT_SECRET` (operator step, see Verification).

Run `pnpm --filter @gdgjp/accounts cf-typegen` afterwards so `worker-configuration.d.ts` picks up the two new
vars. That file is generated — do not hand-edit it.

### 2. Client spec

In `collectSpecs()` in `accounts/app/lib/seed-clients.server.ts`, add one tuple to the `apps` array:

```ts
["GDG Japan Agents", env.AGENTS_CLIENT_ID, env.AGENTS_CLIENT_SECRET, env.AGENTS_REDIRECT_URLS],
```

Everything else — PKCE requirement, grant types, scopes, secret hashing — is already applied uniformly to
every entry in that array. Do not add per-client branching.

### 3. Trusted client

In `buildAuth()` in `accounts/app/lib/auth.server.ts`, add `env.AGENTS_CLIENT_ID` to `trustedClientIds`
(which populates `cachedTrustedClients`). Without it the consent-skip path does not apply to this client and
every link attempt shows a consent screen, which is a poor flow from a Chat message.

### Constraints

- **Do not weaken PKCE or add a `public` client.** Stage 5d's linking flow is written against a confidential
  client with mandatory `S256`. Making the client public to "simplify" the Next.js side removes the client
  secret as an authentication factor.
- **`postLogoutRedirectUris` is derived, and that is fine.** `collectSpecs()` computes it as
  `new URL("/signin", origin)`, so the seeded record will carry `https://agent.gdgs.jp/signin` — a route the
  agents app will never have. agent.gdgs.jp does not initiate RP-initiated logout, so this is inert. Leave it
  alone rather than special-casing the derivation; a "fix" here changes behaviour for all five existing clients.
- Do not change the redirect URI to anything other than `https://agent.gdgs.jp/auth/callback`. Stage 5d
  registers exactly that path.
- Do not commit `.dev.vars`. Only `.dev.vars.example` gains the new key name.
- `accounts/worker-configuration.d.ts` is generated by `cf-typegen`. Do not hand-edit it.
- Scope of this stage is the client registration. Do not create the `agents/` workspace here — that is 5c.
- Follow Biome and use `import type`.

## Files to touch

### `accounts/`

- `wrangler.toml` — two `[vars]` entries
- `app/lib/seed-clients.server.ts` — one tuple in `collectSpecs()`
- `app/lib/auth.server.ts` — one entry in `trustedClientIds`
- `.dev.vars.example` — `AGENTS_CLIENT_SECRET=`
- `worker-configuration.d.ts` — regenerated by `cf-typegen`, not hand-edited

## Verification — Completion Criteria and Validation

### Completion criteria

After deploying and reseeding, `GET https://accounts.gdgs.jp/api/auth/oauth2/authorize?client_id=agents&...`
with a valid `code_challenge` (S256) reaches the sign-in / redirect flow instead of returning
`invalid_client`, and the same request **without** `code_challenge` is rejected. The client record shows
`requirePKCE = 1`, `public = 0`, and `offline_access` among its scopes.

### Commands

```bash
pnpm --filter @gdgjp/accounts cf-typegen
```

```bash
pnpm --filter @gdgjp/accounts typecheck
```

```bash
pnpm ci:quick
```

### Tests to establish as regressions

- `collectSpecs()` returns a spec for `agents` when `AGENTS_CLIENT_ID` / `AGENTS_CLIENT_SECRET` /
  `AGENTS_REDIRECT_URLS` are all present, and **omits it (rather than seeding a secretless client) when
  `AGENTS_CLIENT_SECRET` is missing** — match whatever the existing entries do for a missing secret, and pin
  that behaviour with a test if none exists.
- The returned spec has `requirePKCE` true, `public` false, and includes `offline_access` and the chapters
  scope. This is the property Stage 5d relies on; a silent default change upstream must fail here.
- `agents` appears in the trusted client IDs used by `buildAuth()`.

### Operator steps (not code; run in this order)

1. `pnpm --filter @gdgjp/accounts exec wrangler secret put AGENTS_CLIENT_SECRET` — generate a high-entropy
   secret and record it for the Vercel project environment used by Stage 5d.
2. Deploy `accounts/`.
3. `POST /admin/seed-clients` as an admin. **Skipping this leaves the client unregistered while the code
   suggests otherwise** — the most common failure mode for this change.
4. Confirm with a manual authorize request as described under Completion criteria.
