# Stage 5d — account linking and token lifecycle

## Context — Background and Repository State

Most Wiki content is `restricted`, with granular control through `page_access`. It contains speaker contact
details, budgets, and incident records. So agent.gdgs.jp does not read the Wiki as itself: it links each
Chat user to a GDG account and calls the Wiki API with **that person's** access token. This stage builds that
link — the OAuth flow, the Redis records, and the token lifecycle around them.

This structurally prevents an incident where a page that should not be visible in Chat appears in an answer.
**Do not use chapter-level service authentication.**

**Dependencies:**
- Stage 5a — the `agents` OAuth client must be deployed to accounts.gdgs.jp **and reseeded** through
  `/admin/seed-clients`. Without the reseed the authorize request returns `invalid_client`.
- Stage 5c — the `agents/` workspace and `lib/verify.ts` must exist. A Chat user ID is only a valid lookup
  key because 5c verified the request signature.

**Blocks:** Stage 5e.
**Target workspace:** `agents/` only.

Stage overview: [05-agents-gdgs-jp.md](05-agents-gdgs-jp.md).

### Required reading

- `docs/plans/05a-accounts-agents-client.md` — the client configuration this stage authenticates as
- `docs/plans/05c-agents-workspace.md` — the verification contract this stage depends on
- `docs/260518_sso_migration.md` — authentication architecture for the accounts IdP and its relying parties

### Already-resolved facts (do not re-investigate)

Verified against the deployed accounts configuration. Use these as literals.

| Item | Value |
|---|---|
| Authorize | `https://accounts.gdgs.jp/api/auth/oauth2/authorize` |
| Token | `https://accounts.gdgs.jp/api/auth/oauth2/token` |
| UserInfo | `https://accounts.gdgs.jp/api/auth/oauth2/userinfo` |
| Revoke | `https://accounts.gdgs.jp/api/auth/oauth2/revoke` |
| PKCE | `S256` only, and **mandatory** for this client. `plain` is rejected by the IdP. |
| Client auth | `client_secret_basic`, confidential client |
| Access token lifetime | 3600 s |
| Refresh token lifetime | 2592000 s (30 days) |
| Scopes to request | `openid email profile offline_access https://gdgs.jp/scopes/chapters` |
| Redirect URI | `https://agent.gdgs.jp/auth/callback` — must match the seeded value exactly |

`offline_access` is required for a refresh token, and the chapters scope is required for the Wiki API to see
chapter claims. Omitting either produces a link that appears to work and then denies access to every
chapter-scoped page.

## Design

### 1. Linking flow (Authorization Code with PKCE)

"Encrypt the token in Redis" is not by itself a security boundary. What prevents an attacker from completing
a link into someone else's Chat account is the binding between the OAuth callback and the Chat identity that
started it.

1. On an inquiry from an unlinked user, generate `state` (128-bit random) and a PKCE `code_verifier`, and
   store in Redis under `link:state:<state>` →
   `{ platform, chatUserId, codeVerifier, spaceId, createdAt }` with a **10-minute TTL**.
2. Reply in Chat with the authorization URL carrying `code_challenge` (S256) and that `state`.
3. On `GET /auth/callback`, look up `state` and **delete it in the same operation** (single-use — use
   `GETDEL` or a Lua script, not read-then-delete). A replayed callback finds nothing and is rejected.
   Missing or expired state → 400, and **no token exchange**.
4. Exchange the code with `code_verifier`. Bind the resulting tokens to the `platform` + `chatUserId`
   recovered **from the stored state**, never from a callback query parameter.

`app/auth/callback/route.ts` implements step 3–4; `lib/link-account.ts` holds the flow logic.

### 2. Token storage and rotation

Link records are keyed `link:user:<platform>:<chatUserId>`.

| Item | Decision |
|---|---|
| Access token | Store with its `expires_at`. Refresh when under 60 s remain; never call the Wiki API with an expired token. |
| Refresh token | Encrypt with AES-256-GCM before writing to Redis. Random per-record IV; store `keyVersion` alongside the ciphertext. |
| Key material | `TOKEN_ENCRYPTION_KEYS` — a JSON map of `version → base64 key` in the Vercel project environment. Decrypt with the version recorded on the record; always encrypt with the current version. |
| Rotation | Add a new version, keep the old one for decryption, re-encrypt lazily on the next refresh. Remove the old version once no record references it. **Rotation must never require re-linking every user.** |
| Revocation | On refresh failure with `invalid_grant`, delete the link and return the linking URL again. Do not retry indefinitely. |
| Unlinking | `/unlink` deletes the link record **and** calls the accounts revocation endpoint. Deleting the Redis record alone leaves a live refresh token at the IdP. |
| Key scoping | Key by `(platform, chatUserId)`. A Discord ID and a Google Chat ID must never collide in one namespace. |

`lib/token-crypto.ts` exposes encrypt/decrypt over the versioned key map and nothing else — no Redis access,
so it is testable in isolation.

Redis is a cache, not a system of record. Every code path must handle a missing link record by re-prompting
for linking, never by falling back to any broader identity.

### 3. Redis state adapter

Chat SDK's official state adapters are memory / Redis / ioredis / PostgreSQL — there is no Cloudflare KV
version, which is why this app runs on Vercel. Configure the Redis adapter with `REDIS_URL`. The replay-guard
keys from Stage 5c and the link records here share that connection; keep the key prefixes distinct
(`replay:`, `link:state:`, `link:user:`) so a flush of one class never clears another.

### Constraints

- **Never trust a Chat user ID from an unverified request.** Every entry point into this stage's code must
  already have passed Stage 5c's `lib/verify.ts`. Do not add a second, more permissive path.
- **Do not use chapter-level or app-level service authentication against the Wiki API.** If a user is not
  linked, the answer is a linking URL, not a degraded read.
- Do not store tokens in Redis in plaintext.
- **Do not log tokens, authorization codes, `code_verifier`, or `state` values — including in error paths.**
  An exception handler that dumps the request URL leaks `code` and `state` into Vercel logs.
- The callback must never accept `platform` or `chatUserId` from a query parameter. Both come from the
  stored state record.
- `state` is single-use. Read-and-delete must be atomic.
- Do not change the redirect URI. It must match the seeded value byte for byte.
- Do not build the agent, its tools, or the `/unlink` chat command surface here — those are Stage 5e. This
  stage exposes the link/unlink functions the command will call.
- `agents/` targets Vercel. Do not rewrite it for Cloudflare Workers.
- Follow Biome and use `import type`.

## Files to touch

### `agents/`

- `lib/link-account.ts` (new) — authorization URL construction, state storage, code exchange, link/unlink
- `lib/token-crypto.ts` (new) — AES-256-GCM with versioned keys
- `lib/redis.ts` (new) — shared client and key-prefix helpers
- `app/auth/callback/route.ts` (new) — single-use state consumption and token exchange
- `.env.example` — confirm `IDP_CLIENT_ID`, `IDP_CLIENT_SECRET`, `ACCOUNTS_URL`, `REDIS_URL`,
  `TOKEN_ENCRYPTION_KEYS` are present
- `lib/link-account.test.ts`, `lib/token-crypto.test.ts` (new)

## Verification — Completion Criteria and Validation

### Completion criteria

An inquiry from an unlinked Chat user returns an accounts.gdgs.jp authorization URL; completing it in a
browser creates a link record bound to that Chat user; a second inquiry from the same user now carries a
valid access token. Replaying the callback URL returns 400. `/unlink` removes the record and revokes at the
IdP, after which the next inquiry returns the linking URL again.

### Commands

```bash
pnpm --filter @gdgjp/agents test
```

```bash
pnpm ci:quick
```

### Account-link tests

- A callback with an unknown or expired `state` returns 400 and **performs no token exchange** — assert on
  the fetch mock.
- Replaying a callback with an already-consumed `state` returns 400 (single-use).
- The link is created for the `chatUserId` stored with the `state`, **not** for any value in the callback
  query — pass a conflicting `chatUserId` query parameter and assert it is ignored.
- The authorization URL carries `code_challenge_method=S256`, a `code_challenge` derived from the stored
  `code_verifier`, and both `offline_access` and the chapters scope.
- A refresh token round-trips through encrypt/decrypt; **a record written under key version 1 still decrypts
  after version 2 becomes current**, and re-encrypts to version 2 on the next refresh.
- A refresh failing with `invalid_grant` deletes the link and returns the linking URL rather than retrying.
- An access token with under 60 s remaining triggers a refresh before the Wiki call; an expired token is
  never sent.
- Records are keyed by `(platform, chatUserId)`: the same ID string on Discord and on Google Chat resolves to
  two different links.
- `/unlink` calls the accounts revocation endpoint in addition to deleting the record.
- No test log or error path contains a token, `code`, `code_verifier`, or `state` value.

### Manual E2E

1. Confirm Stage 5a is deployed and `/admin/seed-clients` has been run — otherwise authorize returns
   `invalid_client` and the rest of this list is untestable.
2. From Google Chat, send an inquiry as an unlinked user → a linking URL is returned.
3. Complete the flow in a browser → the callback succeeds and reports the linked account.
4. Reload the callback URL → 400, and the link from step 3 is unaffected.
5. Send a second inquiry → no linking prompt.
6. Repeat steps 2–3 as the same numeric user ID on Discord → a separate link is created; neither overwrites
   the other.
7. Run `/unlink`, then repeat step 2 → the linking URL is returned again.
8. Add a second key version to `TOKEN_ENCRYPTION_KEYS`, redeploy, and confirm the existing link still works
   without re-linking.
